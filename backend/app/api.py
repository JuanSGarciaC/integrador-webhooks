import json
import logging
from typing import Callable

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from app import repository
from app.auth import admin, reader
from app.config import Settings
from app.mapping import SUPPORTED
from app.models import Event
from app.schemas import (AttemptOut, Detail, EventDetail, EventOut, EventPage, EventType,
                         StatsOut, Status)
from app.security import verify_signature

log = logging.getLogger("integrador")


def _json(code: int, **body) -> JSONResponse:
    return JSONResponse(body, status_code=code)


def create_app(settings: Settings, session_factory: sessionmaker, clock: Callable) -> FastAPI:
    app = FastAPI(title="Integrador de webhooks", version="1.0.0")
    router = APIRouter()
    can_read = [Depends(reader(settings))]
    _401 = {401: {"model": Detail}}

    @router.get("/health")
    def health():
        return {"status": "ok"}

    @router.post("/webhooks/github", status_code=202, tags=["webhooks"],
                 responses={200: {"description": "Duplicado"}, 400: {}, 401: {}, 413: {}})
    async def github_webhook(request: Request):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_body_bytes:
            return _json(413, detail="cuerpo demasiado grande")
        body = await request.body()
        if len(body) > settings.max_body_bytes:
            return _json(413, detail="cuerpo demasiado grande")

        if not verify_signature(settings.webhook_secret, body,
                                request.headers.get("x-hub-signature-256")):
            return _json(401, detail="firma inválida o ausente")

        event_type = request.headers.get("x-github-event", "")
        delivery_id = request.headers.get("x-github-delivery", "")
        if not delivery_id:
            return _json(400, detail="falta X-GitHub-Delivery")
        if event_type not in SUPPORTED:
            return _json(400, detail=f"evento no soportado: {event_type or '(vacío)'}")
        try:
            payload = json.loads(body)
        except ValueError:
            return _json(400, detail="JSON inválido")
        if not isinstance(payload, dict):
            return _json(400, detail="el cuerpo debe ser un objeto JSON")

        def store():
            with session_factory() as s:
                return repository.create_event(s, "github", delivery_id, event_type,
                                               body.decode("utf-8", "replace"), clock())

        ev, created = await run_in_threadpool(store)
        if not created:
            log.info(json.dumps({"msg": "duplicado", "delivery_id": delivery_id}))
            return _json(200, detail="duplicado, ya recibido")
        log.info(json.dumps({"msg": "recibido", "event_id": ev.id, "delivery_id": delivery_id,
                             "status": ev.status, "attempt": 0}))
        return _json(202, id=ev.id, status=ev.status)

    @router.get("/api/events", response_model=EventPage, tags=["events"],
                dependencies=can_read, responses=_401)
    def list_events(status: Status | None = None, event_type: EventType | None = None,
                    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
        with session_factory() as s:
            total, items = repository.list_events(s, status, event_type, limit, offset)
            return EventPage(total=total, items=[EventOut.model_validate(e) for e in items])

    @router.get("/api/events/{event_id}", response_model=EventDetail, tags=["events"],
                dependencies=can_read, responses={**_401, 404: {"model": Detail}})
    def get_event(event_id: str):
        with session_factory() as s:
            ev = s.get(Event, event_id)
            if ev is None:
                return _json(404, detail="evento no encontrado")
            data = EventOut.model_validate(ev).model_dump()
            return EventDetail(**data, payload=ev.payload,
                               attempt_history=[AttemptOut.model_validate(a) for a in ev.attempt_log])

    @router.post("/api/events/{event_id}/replay", response_model=EventOut, tags=["events"],
                 dependencies=[Depends(admin(settings))],
                 responses={**_401, 404: {"model": Detail}, 409: {"model": Detail}})
    def replay_event(event_id: str):
        with session_factory() as s:
            try:
                ev = repository.replay(s, event_id, clock())
            except repository.NotFound:
                return _json(404, detail="evento no encontrado")
            except repository.NotDead as exc:
                return _json(409, detail=f"solo se reprocesan eventos en 'dead' (actual: {exc})")
            log.info(json.dumps({"msg": "reproceso", "event_id": ev.id, "status": ev.status}))
            return EventOut.model_validate(ev)

    @router.get("/api/stats", response_model=StatsOut, tags=["events"],
                dependencies=can_read, responses=_401)
    def get_stats():
        with session_factory() as s:
            return repository.stats(s)

    app.include_router(router)
    return app

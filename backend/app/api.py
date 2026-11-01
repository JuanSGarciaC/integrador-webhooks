import hashlib
import hmac
import json
import logging
import uuid
from typing import Callable

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from app import repository
from app.auth import admin, reader
from app.config import Settings
from app.demo import RateLimiter, build_payload, client_ip
from app.mapping import SUPPORTED
from app.models import Event
from app.schemas import (AttemptOut, DemoInfo, Detail, EventDetail, EventOut, EventPage, EventType,
                         SimulateIn, StatsOut, Status)
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
        return await ingest(await request.body(), request.headers)

    async def ingest(body: bytes, headers) -> JSONResponse:
        """Camino único de entrada: lo usan el webhook real y el simulador de la demo."""
        if len(body) > settings.max_body_bytes:
            return _json(413, detail="cuerpo demasiado grande")

        if not verify_signature(settings.webhook_secret, body,
                                headers.get("x-hub-signature-256")):
            return _json(401, detail="firma inválida o ausente")

        event_type = headers.get("x-github-event", "")
        delivery_id = headers.get("x-github-delivery", "")
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

    @router.get("/api/demo", response_model=DemoInfo, tags=["demo"])
    def demo_info():
        return DemoInfo(demo=settings.demo_mode)

    if settings.demo_mode:
        limiter = RateLimiter(settings.demo_rate_per_minute, clock)

        def make_room() -> bool:
            with session_factory() as s:
                excess = repository.count_events(s) - settings.demo_max_events + 1
                return excess <= 0 or repository.purge_oldest_final(s, excess) == excess

        @router.post("/api/demo/simulate", status_code=202, tags=["demo"], dependencies=can_read,
                     responses={**_401, 422: {}, 429: {"model": Detail}},
                     description="Solo existe con DEMO_MODE: crea un evento ficticio firmado "
                                 "que entra por el mismo camino que POST /webhooks/github.")
        async def simulate(data: SimulateIn, request: Request):
            if not limiter.allow(client_ip(request, settings.client_ip_header)):
                return _json(429, detail="demasiadas simulaciones, espera un minuto")
            if not await run_in_threadpool(make_room):
                return _json(429, detail="demo llena, prueba en un minuto")
            body = build_payload(data.scenario)
            sig = "sha256=" + hmac.new(settings.webhook_secret.encode(), body,
                                       hashlib.sha256).hexdigest()
            return await ingest(body, {"x-github-event": "push",
                                       "x-github-delivery": str(uuid.uuid4()),
                                       "x-hub-signature-256": sig})

    app.include_router(router)
    return app

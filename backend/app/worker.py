"""Worker: python -m app.worker"""
import json
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
from sqlalchemy.orm import sessionmaker

from app import repository
from app.config import Settings, load_settings
from app.database import init_db, make_engine, make_session_factory
from app.mapping import normalize
from app.retry import Outcome, backoff_delay, classify, parse_retry_after

log = logging.getLogger("worker")


def utc_now() -> datetime:
    """UTC ingenuo: SQLite no guarda zona horaria."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _deliver(http: httpx.Client, settings: Settings, ev, now: datetime):
    """POST al destino. Devuelve (http_status|None, error|None, retry_after_header|None, ms)."""
    body = normalize(ev.id, ev.event_type, json.loads(ev.payload), ev.received_at.isoformat())
    t0 = time.perf_counter()
    try:
        r = http.post(settings.downstream_url, json=body, headers={"Idempotency-Key": ev.id},
                      timeout=settings.http_timeout_seconds)
    except httpx.HTTPError as exc:
        return None, f"{type(exc).__name__}: {exc}", None, int((time.perf_counter() - t0) * 1000)
    ms = int((time.perf_counter() - t0) * 1000)
    err = None if r.is_success else f"HTTP {r.status_code}"
    return r.status_code, err, r.headers.get("Retry-After"), ms


def process_once(session_factory: sessionmaker, settings: Settings, http: httpx.Client,
                 clock: Callable[[], datetime] = utc_now,
                 jitter: Callable[[], float] = random.random) -> int:
    """Procesa un lote de eventos vencidos. Devuelve cuántos tomó."""
    with session_factory() as s:
        claimed = repository.claim_due(s, clock(), settings.lock_seconds, settings.batch_size)
        batch = [(e.id, e) for e in claimed]
    for event_id, ev in batch:
        status, error, retry_after, ms = _deliver(http, settings, ev, clock())
        now = clock()
        outcome = classify(status)
        attempt_no = ev.attempts + 1
        next_at = None
        if outcome is Outcome.DELIVERED:
            new_status = "delivered"
        elif outcome is Outcome.DEAD or attempt_no >= settings.max_attempts:
            new_status = "dead"
        else:
            new_status = "retrying"
            wait = parse_retry_after(retry_after, now) if status == 429 else None
            if wait is None:
                wait = backoff_delay(attempt_no, settings.retry_base_seconds, settings.retry_factor,
                                     settings.retry_cap_seconds, jitter)
            next_at = now + timedelta(seconds=wait)
        with session_factory() as s:
            repository.record_result(s, event_id, now=now, http_status=status, duration_ms=ms,
                                     error=error, new_status=new_status, next_attempt_at=next_at)
        log.info(json.dumps({"msg": "intento", "event_id": event_id, "delivery_id": ev.delivery_id,
                             "status": new_status, "attempt": attempt_no, "http_status": status}))
    return len(batch)


def run_forever(settings: Settings | None = None) -> None:
    settings = settings or load_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    factory = make_session_factory(engine)
    with httpx.Client() as http:
        while True:
            if process_once(factory, settings, http) == 0:
                time.sleep(settings.poll_interval_seconds)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    run_forever()

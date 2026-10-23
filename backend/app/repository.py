import math
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import STATUSES, DeliveryAttempt, Event


def create_event(s: Session, source: str, delivery_id: str, event_type: str,
                 payload: str, now: datetime) -> tuple[Event | None, bool]:
    """Inserta el evento; (None, False) si ya existía (source, delivery_id)."""
    ev = Event(source=source, delivery_id=delivery_id, event_type=event_type, payload=payload,
               status="received", attempts=0, next_attempt_at=now, received_at=now)
    s.add(ev)
    try:
        s.commit()
    except IntegrityError:
        s.rollback()
        return None, False
    return ev, True


def claim_due(s: Session, now: datetime, lock_seconds: float, limit: int) -> list[Event]:
    """Toma eventos listos o con bloqueo vencido y los marca `processing`.

    Cada candidato se reclama con un UPDATE condicional (compare-and-set), de modo que
    dos workers nunca obtienen el mismo evento.
    """
    due = or_(
        and_(Event.status.in_(("received", "retrying")), Event.next_attempt_at <= now),
        and_(Event.status == "processing", Event.locked_until <= now),
    )
    candidates = s.scalars(
        select(Event).where(due).order_by(Event.next_attempt_at).limit(limit)).all()
    claimed: list[Event] = []
    until = now + timedelta(seconds=lock_seconds)
    for ev in candidates:
        res = s.execute(
            update(Event).where(Event.id == ev.id, Event.status == ev.status,
                                Event.locked_until == ev.locked_until)  # None -> IS NULL
            .values(status="processing", locked_until=until))
        if res.rowcount == 1:
            claimed.append(ev)
    s.commit()
    for ev in claimed:
        s.refresh(ev)
    return claimed


def record_result(s: Session, event_id: str, *, now: datetime, http_status: int | None,
                  duration_ms: int, error: str | None, new_status: str,
                  next_attempt_at: datetime | None = None) -> Event:
    ev = s.get(Event, event_id)
    ev.attempts += 1
    ev.status = new_status
    ev.locked_until = None
    ev.last_error = error
    if new_status == "delivered":
        ev.delivered_at = now
        ev.last_error = None
    if next_attempt_at is not None:
        ev.next_attempt_at = next_attempt_at
    s.add(DeliveryAttempt(event_id=event_id, attempted_at=now, http_status=http_status,
                          duration_ms=duration_ms, error=error))
    s.commit()
    return ev


def list_events(s: Session, status: str | None, event_type: str | None,
                limit: int, offset: int) -> tuple[int, list[Event]]:
    q = select(Event)
    if status:
        q = q.where(Event.status == status)
    if event_type:
        q = q.where(Event.event_type == event_type)
    total = s.scalar(select(func.count()).select_from(q.subquery()))
    items = s.scalars(q.order_by(Event.received_at.desc(), Event.id).limit(limit).offset(offset)).all()
    return total, list(items)


def _percentile(sorted_values: list[float], p: float) -> float | None:
    """Rango más cercano (nearest-rank)."""
    if not sorted_values:
        return None
    k = max(1, math.ceil(p / 100 * len(sorted_values)))
    return sorted_values[k - 1]


def stats(s: Session) -> dict:
    by_status = {st: 0 for st in STATUSES}
    for st, n in s.execute(select(Event.status, func.count()).group_by(Event.status)):
        by_status[st] = n
    total = sum(by_status.values())
    avg_attempts = s.scalar(select(func.avg(Event.attempts)).where(Event.attempts > 0))
    times = sorted((d - r).total_seconds() for r, d in s.execute(
        select(Event.received_at, Event.delivered_at).where(Event.status == "delivered")))
    return {
        "total": total,
        "by_status": by_status,
        "avg_attempts": round(avg_attempts, 2) if avg_attempts is not None else None,
        "delivered_ratio": by_status["delivered"] / total if total else None,
        "delivery_seconds": {"p50": _percentile(times, 50), "p95": _percentile(times, 95)},
    }


class NotFound(Exception):
    pass


class NotDead(Exception):
    pass


def replay(s: Session, event_id: str, now: datetime) -> Event:
    """dead -> retrying. Reinicia el conteo de intentos para dar un ciclo completo."""
    ev = s.get(Event, event_id)
    if ev is None:
        raise NotFound(event_id)
    if ev.status != "dead":
        raise NotDead(ev.status)
    ev.status = "retrying"
    ev.attempts = 0
    ev.next_attempt_at = now
    ev.locked_until = None
    s.commit()
    return ev

import enum
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable


class Outcome(enum.Enum):
    DELIVERED = "delivered"
    RETRY = "retry"
    DEAD = "dead"


def backoff_delay(attempt: int, base: float, factor: float, cap: float,
                  jitter: Callable[[], float]) -> float:
    """Jitter completo: uniforme en [0, min(cap, base*factor^(attempt-1))]."""
    window = min(cap, base * factor ** (attempt - 1))
    return window * jitter()


def classify(http_status: int | None) -> Outcome:
    """None = timeout o error de conexión (transitorio)."""
    if http_status is None:
        return Outcome.RETRY
    if 200 <= http_status < 300:
        return Outcome.DELIVERED
    if http_status == 429 or http_status >= 500:
        return Outcome.RETRY
    return Outcome.DEAD


def parse_retry_after(value: str | None, now: datetime) -> float | None:
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - now).total_seconds())

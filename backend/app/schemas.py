from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.demo import Scenario

Status = Literal["received", "processing", "retrying", "delivered", "dead"]
EventType = Literal["push", "issues", "pull_request", "ping"]


class SimulateIn(BaseModel):
    scenario: Scenario


class DemoInfo(BaseModel):
    demo: bool
    destination: Literal["mock", "triaje"]


class AttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attempted_at: datetime
    http_status: int | None
    duration_ms: int
    error: str | None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    source: str
    delivery_id: str
    event_type: str
    status: Status
    attempts: int
    next_attempt_at: datetime
    last_error: str | None
    received_at: datetime
    delivered_at: datetime | None


class EventDetail(EventOut):
    payload: str
    outbound: dict  # lo que el worker envía al destino para este evento
    attempt_history: list[AttemptOut] = []


class EventPage(BaseModel):
    total: int
    items: list[EventOut]


class Percentiles(BaseModel):
    p50: float | None
    p95: float | None


class StatsOut(BaseModel):
    total: int
    by_status: dict[str, int]
    avg_attempts: float | None
    delivered_ratio: float | None
    delivery_seconds: Percentiles


class Detail(BaseModel):
    detail: str

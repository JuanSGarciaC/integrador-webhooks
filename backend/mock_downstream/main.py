"""Destino simulado: falla a propósito y aplica cada Idempotency-Key una sola vez.

Uso HTTP:  uvicorn mock_downstream.main:app --port 9000
Env: FAILURE_RATE, RATE_LIMIT_RATE (0..1).
"""
import json
import os
import random
import threading

import httpx
from fastapi import FastAPI, Request, Response


class MockDownstream:
    def __init__(self, failure_rate: float = 0.0, rate_limit_rate: float = 0.0,
                 seed: int | None = None, idempotent: bool = True,
                 lost_ack_share: float = 0.0):
        """lost_ack_share: fracción de los fallos que aplican el efecto y luego devuelven 503
        (respuesta perdida). Hace que el reintento sea una entrega redundante real."""
        self.failure_rate = failure_rate
        self.rate_limit_rate = rate_limit_rate
        self.idempotent = idempotent
        self.lost_ack_share = lost_ack_share
        self.redundant_requests = 0  # 2xx para una key ya aplicada (idempotencia en acción)
        self._rng = random.Random(seed)
        self._lock = threading.Lock()
        self.applied: dict[str, int] = {}  # Idempotency-Key -> veces que se aplicó el efecto
        self.received: list[dict] = []  # eventos aplicados (para GET /received)

    def decide(self, key: str | None, body: dict) -> tuple[int, dict]:
        """Devuelve (status, headers). Un 2xx aplica el efecto (una vez si es idempotente)."""
        with self._lock:
            roll = self._rng.random()
            if roll < self.rate_limit_rate:
                return 429, {"Retry-After": "1"}
            if not key:
                return 400, {}
            failing = roll < self.rate_limit_rate + self.failure_rate
            if failing and self._rng.random() >= self.lost_ack_share:
                return 503, {}
            self._apply(key, body)
            return (503, {}) if failing else (200, {})

    def _apply(self, key: str, body: dict) -> None:
        if self.idempotent and key in self.applied:
            self.redundant_requests += 1  # ya aplicado: no se repite el efecto
            return
        self.applied[key] = self.applied.get(key, 0) + 1
        self.received.append(body)

    def handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        status, headers = self.decide(request.headers.get("Idempotency-Key"), body)
        return httpx.Response(status, headers=headers)

    def applied_count(self, key: str) -> int:
        return self.applied.get(key, 0)

    def duplicate_applications(self) -> int:
        return sum(n - 1 for n in self.applied.values() if n > 1)


def create_mock_app(mock: MockDownstream) -> FastAPI:
    app = FastAPI(title="Destino simulado")

    @app.post("/ingest")
    async def ingest(request: Request):
        status, headers = mock.decide(request.headers.get("Idempotency-Key"),
                                      await request.json())
        return Response(status_code=status, headers=headers)

    @app.get("/received")
    def received():
        return mock.received

    return app


app = create_mock_app(MockDownstream(float(os.environ.get("FAILURE_RATE", 0)),
                                     float(os.environ.get("RATE_LIMIT_RATE", 0))))

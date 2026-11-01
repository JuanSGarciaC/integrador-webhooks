"""Demo pública: escenarios del simulador (el destino simulado los interpreta por `repository`)."""
import json
import threading
from datetime import datetime
from typing import Callable, Literal

from fastapi import Request

Scenario = Literal["ok", "recover", "rate_limit", "timeout", "rejected"]


def build_payload(scenario: str) -> bytes:
    """Payload `push` ficticio: sin datos de personas reales."""
    return json.dumps({
        "ref": "refs/heads/main",
        "commits": [{}],
        "repository": {"full_name": f"demo/{scenario}"},
        "sender": {"login": "visitante-demo"},
    }).encode()


def client_ip(request: Request, trusted_header: str = "") -> str:
    """IP del visitante. Solo se confía en una cabecera si se configuró explícitamente
    (en Render: True-Client-IP, que fija Cloudflare). X-Forwarded-For nunca: Render añade
    al valor que manda el cliente, así que se puede falsear."""
    if trusted_header:
        value = request.headers.get(trusted_header, "").strip()
        if value:
            return value
    return request.client.host if request.client else "desconocida"


class RateLimiter:
    """Ventana fija por minuto y clave.
    shortcut: en memoria y por proceso, válido con un solo contenedor; usar Redis si hay réplicas."""

    def __init__(self, per_minute: int, clock: Callable[[], datetime]):
        self.per_minute = per_minute
        self.clock = clock
        self._window: datetime | None = None
        self._counts: dict[str, int] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        window = self.clock().replace(second=0, microsecond=0)
        with self._lock:
            if window != self._window:  # ventana nueva: se descartan los contadores viejos
                self._window, self._counts = window, {}
            if self._counts.get(key, 0) >= self.per_minute:
                return False
            self._counts[key] = self._counts.get(key, 0) + 1
            return True

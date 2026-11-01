"""E2E contra la demo en marcha (contenedor). Aquí sí se usa tiempo real: el worker de verdad
reintenta con su propio reloj. Por eso esta carpeta no está en `testpaths` y se ejecuta aparte:
    E2E_BASE_URL=http://127.0.0.1:8080 ADMIN_TOKEN=... WEBHOOK_SECRET=... pytest tests_e2e
"""
import os
import time

import httpx
import pytest

BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8080")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
FINAL = ("delivered", "dead")


@pytest.fixture(scope="session")
def anon():
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        yield c


@pytest.fixture(scope="session")
def admin():
    assert ADMIN_TOKEN, "define ADMIN_TOKEN para los E2E"
    with httpx.Client(base_url=BASE_URL, timeout=10,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


def simulate(client: httpx.Client, scenario: str) -> str:
    r = client.post("/api/demo/simulate", json={"scenario": scenario})
    assert r.status_code == 202, r.text
    return r.json()["id"]


def wait_final(client: httpx.Client, event_id: str, timeout: float = 60) -> dict:
    """Sondea el detalle hasta delivered/dead; si vence el plazo falla con el último estado."""
    deadline = time.monotonic() + timeout
    while True:
        ev = client.get(f"/api/events/{event_id}").json()
        if ev["status"] in FINAL:
            return ev
        if time.monotonic() > deadline:
            raise AssertionError(f"{event_id} sigue en {ev['status']} tras {timeout}s")
        time.sleep(0.5)

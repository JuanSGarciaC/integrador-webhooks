"""Ciclo completo contra la imagen de demo: API + worker + destino simulado reales."""
import hashlib
import hmac
import json
import uuid

import pytest

from tests_e2e.conftest import WEBHOOK_SECRET, simulate, wait_final


@pytest.mark.parametrize("scenario,status,codes", [
    ("ok", "delivered", [200]),
    ("recover", "delivered", [503, 503, 200]),
    ("rate_limit", "delivered", [429, 200]),
    ("timeout", "delivered", [None, 200]),
    ("rejected", "dead", [422]),
])
def test_escenario_extremo_a_extremo(anon, scenario, status, codes):
    ev = wait_final(anon, simulate(anon, scenario))
    assert ev["status"] == status
    assert [a["http_status"] for a in ev["attempt_history"]] == codes


def test_webhook_firmado_y_duplicado(anon):
    assert WEBHOOK_SECRET, "define WEBHOOK_SECRET para los E2E"
    body = json.dumps({"zen": "e2e", "sender": {"login": "e2e"}}).encode()
    headers = {"X-GitHub-Event": "ping", "X-GitHub-Delivery": f"e2e-{uuid.uuid4()}",
               "Content-Type": "application/json",
               "X-Hub-Signature-256": "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body,
                                                           hashlib.sha256).hexdigest()}
    first = anon.post("/webhooks/github", content=body, headers=headers)
    assert first.status_code == 202
    total = anon.get("/api/events").json()["total"]
    again = anon.post("/webhooks/github", content=body, headers=headers)
    assert again.status_code == 200
    assert anon.get("/api/events").json()["total"] == total


def test_firma_invalida_401(anon):
    r = anon.post("/webhooks/github", content=b"{}", headers={
        "X-GitHub-Event": "ping", "X-GitHub-Delivery": "e2e-bad", "X-Hub-Signature-256": "sha256=00"})
    assert r.status_code == 401


def test_replay_sin_token_401_y_con_token_entrega(anon, admin):
    event_id = simulate(anon, "rejected")
    assert wait_final(anon, event_id)["status"] == "dead"
    denied = anon.post(f"/api/events/{event_id}/replay")
    assert denied.status_code == 401 and denied.headers["WWW-Authenticate"] == "Bearer"
    assert admin.post(f"/api/events/{event_id}/replay").status_code == 200
    ev = wait_final(anon, event_id)
    assert ev["status"] == "delivered" and len(ev["attempt_history"]) == 2


def test_token_incorrecto_401(anon):
    r = anon.get("/api/events", headers={"Authorization": "Bearer malo"})
    assert r.status_code == 401

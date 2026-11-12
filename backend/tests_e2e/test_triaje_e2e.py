"""Conexión real con triaje-solicitudes (docker-compose.triaje.yml):
    TRIAJE_URL=http://127.0.0.1:8081 WEBHOOK_SECRET=... pytest tests_e2e/test_triaje_e2e.py
"""
import hashlib
import hmac
import json
import os
import uuid

import httpx
import pytest

from tests_e2e.conftest import WEBHOOK_SECRET, simulate, wait_final

TRIAJE_URL = os.environ.get("TRIAJE_URL", "")
pytestmark = pytest.mark.skipif(not TRIAJE_URL, reason="define TRIAJE_URL (stack con triaje)")


@pytest.fixture(scope="module")
def triaje():
    with httpx.Client(base_url=TRIAJE_URL, timeout=10) as c:
        yield c


def test_issue_llega_a_triaje_y_un_reenvio_no_lo_duplica(anon, triaje):
    antes = len(triaje.get("/api/requests?limit=200").json())
    ev = wait_final(anon, simulate(anon, "issue"))
    assert ev["status"] == "delivered"
    assert [a["http_status"] for a in ev["attempt_history"]] == [201]

    solicitudes = triaje.get("/api/requests?limit=200").json()
    assert len(solicitudes) == antes + 1
    creada = solicitudes[0]  # la más reciente primero
    assert (creada["subject"], creada["requester"]) == (ev["outbound"]["subject"], "visitante-demo")
    assert creada["pred_category"]  # triaje la clasificó

    # Entrega «al menos una vez»: el mismo evento puede llegar dos veces con la misma clave.
    otra_vez = triaje.post("/api/requests", json=ev["outbound"], headers={"Idempotency-Key": ev["id"]})
    assert otra_vez.status_code == 200 and otra_vez.json()["id"] == creada["id"]
    assert len(triaje.get("/api/requests?limit=200").json()) == antes + 1


def test_un_push_se_ignora_y_no_se_guarda(anon):
    assert WEBHOOK_SECRET, "define WEBHOOK_SECRET para los E2E"
    body = json.dumps({"ref": "refs/heads/main", "commits": [{}], "sender": {"login": "e2e"}}).encode()
    antes = anon.get("/api/events").json()["total"]
    r = anon.post("/webhooks/github", content=body, headers={
        "X-GitHub-Event": "push", "X-GitHub-Delivery": f"e2e-{uuid.uuid4()}", "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()})
    assert r.status_code == 200 and "ignorado" in r.json()["detail"]
    assert anon.get("/api/events").json()["total"] == antes

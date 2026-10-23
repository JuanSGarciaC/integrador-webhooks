import httpx

from app.worker import process_once
from tests.conftest import post_webhook


def worker(session_factory, settings, clock, statuses):
    seq = list(statuses)
    http = httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(seq.pop(0) if len(seq) > 1 else seq[0])))
    return process_once(session_factory, settings, http, clock, jitter=lambda: 1.0)


def make_dead(client, session_factory, settings, clock, delivery="d-dead"):
    r = post_webhook(client, delivery=delivery)
    worker(session_factory, settings, clock, [400])
    return r.json()["id"]


def test_replay_dead_a_delivered(client, session_factory, settings, clock):
    eid = make_dead(client, session_factory, settings, clock)
    r = client.post(f"/api/events/{eid}/replay")
    assert r.status_code == 200 and r.json()["status"] == "retrying"
    assert worker(session_factory, settings, clock, [200]) == 1
    d = client.get(f"/api/events/{eid}").json()
    assert d["status"] == "delivered"
    assert [a["http_status"] for a in d["attempt_history"]] == [400, 200]


def test_replay_409_si_no_esta_dead(client):
    eid = post_webhook(client).json()["id"]
    assert client.post(f"/api/events/{eid}/replay").status_code == 409


def test_replay_404(client):
    assert client.post("/api/events/no-existe/replay").status_code == 404


def test_detalle_404(client):
    assert client.get("/api/events/no-existe").status_code == 404


def test_lista_con_filtros_y_paginacion(client, session_factory, settings, clock):
    make_dead(client, session_factory, settings, clock, "a")
    post_webhook(client, delivery="b")
    post_webhook(client, event="ping", payload={"zen": "z"}, delivery="c")
    assert client.get("/api/events").json()["total"] == 3
    assert client.get("/api/events?status=dead").json()["total"] == 1
    assert client.get("/api/events?event_type=ping").json()["total"] == 1
    page = client.get("/api/events?limit=2&offset=2").json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert "payload" not in page["items"][0]


def test_lista_parametros_invalidos_422(client):
    assert client.get("/api/events?limit=0").status_code == 422
    assert client.get("/api/events?limit=10000").status_code == 422
    assert client.get("/api/events?offset=-1").status_code == 422
    assert client.get("/api/events?status=inventado").status_code == 422


def test_stats(client, session_factory, settings, clock):
    empty = client.get("/api/stats").json()
    assert empty["total"] == 0 and empty["delivered_ratio"] is None
    post_webhook(client, delivery="ok")
    clock.advance(5)
    worker(session_factory, settings, clock, [200])
    make_dead(client, session_factory, settings, clock, "dead")
    s = client.get("/api/stats").json()
    assert s["total"] == 2
    assert s["by_status"]["delivered"] == 1 and s["by_status"]["dead"] == 1
    assert s["avg_attempts"] == 1.0
    assert s["delivery_seconds"]["p50"] == 5.0 and s["delivery_seconds"]["p95"] == 5.0
    assert s["delivered_ratio"] == 0.5

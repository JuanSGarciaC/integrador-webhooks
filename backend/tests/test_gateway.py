import httpx
from fastapi.testclient import TestClient

from app.gateway import create_gateway


def make(handler):
    return TestClient(create_gateway("http://api.local", httpx.Client(
        transport=httpx.MockTransport(handler))))


def test_reenvia_solo_el_webhook_con_cuerpo_y_cabeceras():
    seen = {}

    def upstream(req: httpx.Request):
        seen.update(url=str(req.url), body=req.content, sig=req.headers["x-hub-signature-256"],
                    delivery=req.headers["x-github-delivery"])
        return httpx.Response(202, json={"id": "1"})

    r = make(upstream).post("/webhooks/github", content=b'{"a":1}', headers={
        "X-Hub-Signature-256": "sha256=ab", "X-GitHub-Delivery": "d1", "X-GitHub-Event": "ping"})
    assert r.status_code == 202 and r.json() == {"id": "1"}
    assert seen == {"url": "http://api.local/webhooks/github", "body": b'{"a":1}',
                    "sig": "sha256=ab", "delivery": "d1"}


def test_no_expone_nada_mas():
    def upstream(req):
        raise AssertionError("no debe llegar a la API")

    c = make(upstream)
    for path in ("/api/events", "/api/stats", "/health", "/docs", "/openapi.json"):
        assert c.get(path).status_code == 404
    assert c.post("/api/events/x/replay").status_code == 404
    assert c.get("/webhooks/github").status_code == 405


def test_api_caida_devuelve_502():
    def upstream(req):
        raise httpx.ConnectError("caída")

    r = make(upstream).post("/webhooks/github", content=b"{}")
    assert r.status_code == 502

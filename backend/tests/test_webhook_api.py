from sqlalchemy import select

from app.models import Event
from tests.conftest import post_webhook, sign


def count(session_factory):
    with session_factory() as s:
        return len(s.scalars(select(Event)).all())


def test_valido_202_y_guarda(client, session_factory):
    r = post_webhook(client)
    assert r.status_code == 202
    assert count(session_factory) == 1
    with session_factory() as s:
        e = s.scalars(select(Event)).one()
        assert e.status == "received" and e.attempts == 0 and e.event_type == "push"


def test_firma_invalida_401_y_no_guarda(client, session_factory):
    r = post_webhook(client, secret="otro")
    assert r.status_code == 401
    assert count(session_factory) == 0


def test_firma_ausente_401(client):
    body = b"{}"
    r = client.post("/webhooks/github", content=body,
                    headers={"X-GitHub-Event": "ping", "X-GitHub-Delivery": "x"})
    assert r.status_code == 401


def test_duplicado_200_sin_segundo_registro(client, session_factory):
    assert post_webhook(client, delivery="dup").status_code == 202
    assert post_webhook(client, delivery="dup").status_code == 200
    assert count(session_factory) == 1


def test_cuerpo_grande_413(client, session_factory):
    r = post_webhook(client, raw=b"x" * 5000)
    assert r.status_code == 413
    assert count(session_factory) == 0


def test_json_invalido_con_firma_valida_400(client):
    assert post_webhook(client, raw=b"{no es json").status_code == 400


def test_json_no_objeto_400(client):
    assert post_webhook(client, raw=b"[1,2]").status_code == 400


def test_evento_no_soportado_400(client, session_factory):
    assert post_webhook(client, event="fork", payload={}).status_code == 400
    assert count(session_factory) == 0


def test_sin_delivery_id_400(client):
    body = b"{}"
    r = client.post("/webhooks/github", content=body,
                    headers={"X-GitHub-Event": "ping", "X-Hub-Signature-256": sign(body)})
    assert r.status_code == 400


def test_ping_aceptado(client):
    assert post_webhook(client, event="ping", payload={"zen": "hola"}, delivery="p1").status_code == 202


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}

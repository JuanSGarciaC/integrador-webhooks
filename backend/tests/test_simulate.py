import json

import pytest
from sqlalchemy import select

from app.models import Event
from tests.conftest import AUTH


@pytest.fixture
def demo(make_client):
    return make_client(demo_mode=True)


def events(session_factory):
    with session_factory() as s:
        return s.scalars(select(Event).order_by(Event.received_at)).all()


def test_simular_crea_evento_por_el_camino_del_webhook(demo, session_factory):
    r = demo.post("/api/demo/simulate", json={"scenario": "recover"})
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "received"
    [ev] = events(session_factory)
    assert ev.id == body["id"] and ev.event_type == "push" and ev.source == "github"
    payload = json.loads(ev.payload)
    assert payload["repository"]["full_name"] == "demo/recover"
    assert payload["sender"]["login"] == "visitante-demo"


def test_cada_simulacion_es_un_evento_nuevo(demo, session_factory):
    for _ in range(2):
        assert demo.post("/api/demo/simulate", json={"scenario": "ok"}).status_code == 202
    evs = events(session_factory)
    assert len(evs) == 2 and evs[0].delivery_id != evs[1].delivery_id


def test_escenario_desconocido_422(demo):
    assert demo.post("/api/demo/simulate", json={"scenario": "borrar-todo"}).status_code == 422


def test_cuerpo_invalido_422(demo):
    r = demo.post("/api/demo/simulate", content=b"no-json",
                  headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_simulate_no_existe_fuera_de_demo(make_client):
    r = make_client(headers=AUTH).post("/api/demo/simulate", json={"scenario": "ok"})
    assert r.status_code == 404


@pytest.mark.parametrize("flag", [False, True])
def test_demo_info_es_publico(make_client, flag):
    r = make_client(demo_mode=flag).get("/api/demo")
    assert r.status_code == 200 and r.json() == {"demo": flag}


def test_simular_con_token_incorrecto_401(make_client):
    c = make_client(headers={"Authorization": "Bearer malo"}, demo_mode=True)
    assert c.post("/api/demo/simulate", json={"scenario": "ok"}).status_code == 401

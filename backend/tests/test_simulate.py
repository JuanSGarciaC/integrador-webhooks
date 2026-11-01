import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.models import DeliveryAttempt, Event
from app.worker import process_once
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


# --- Límite por IP y tope de eventos ---


def sim(c, headers=None, scenario="ok"):
    return c.post("/api/demo/simulate", json={"scenario": scenario}, headers=headers or {})


def deliver_all(session_factory, settings, clock, status=200):
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status)))
    process_once(session_factory, settings, http, clock, jitter=lambda: 1.0)


def test_limite_por_ip(make_client, clock):
    c = make_client(demo_mode=True, demo_rate_per_minute=2)
    assert [sim(c).status_code for _ in range(3)] == [202, 202, 429]
    assert sim(c).json() == {"detail": "demasiadas simulaciones, espera un minuto"}
    clock.advance(60)
    assert sim(c).status_code == 202


def test_x_forwarded_for_falseado_no_esquiva(make_client):
    # Render añade al X-Forwarded-For que manda el cliente: nunca se usa.
    c = make_client(demo_mode=True, demo_rate_per_minute=1)
    assert sim(c, {"X-Forwarded-For": "1.1.1.1"}).status_code == 202
    assert sim(c, {"X-Forwarded-For": "2.2.2.2"}).status_code == 429


def test_cabecera_fiable_configurada_separa_visitantes(make_client):
    c = make_client(demo_mode=True, demo_rate_per_minute=1, client_ip_header="True-Client-IP")
    assert sim(c, {"True-Client-IP": "9.9.9.9"}).status_code == 202
    assert sim(c, {"True-Client-IP": "8.8.8.8"}).status_code == 202
    assert sim(c, {"True-Client-IP": "9.9.9.9"}).status_code == 429


def test_cabecera_no_configurada_se_ignora(make_client):
    c = make_client(demo_mode=True, demo_rate_per_minute=1)
    assert sim(c, {"True-Client-IP": "9.9.9.9"}).status_code == 202
    assert sim(c, {"True-Client-IP": "8.8.8.8"}).status_code == 429


def test_tope_purga_el_final_mas_antiguo(make_client, session_factory, settings, clock):
    c = make_client(demo_mode=True, demo_max_events=2)
    first = sim(c).json()["id"]
    clock.advance(1)
    second = sim(c).json()["id"]
    deliver_all(session_factory, settings, clock)
    clock.advance(1)
    assert sim(c).status_code == 202
    ids = [e.id for e in events(session_factory)]
    assert len(ids) == 2 and first not in ids and second in ids
    with session_factory() as s:
        assert s.scalars(select(DeliveryAttempt).where(DeliveryAttempt.event_id == first)).all() == []


def test_tope_no_purga_pendientes(make_client, session_factory, settings, clock):
    c = make_client(demo_mode=True, demo_max_events=1)
    pending = sim(c).json()["id"]
    deliver_all(session_factory, settings, clock, status=503)  # queda en retrying
    r = sim(c)
    assert r.status_code == 429 and r.json() == {"detail": "demo llena, prueba en un minuto"}
    [ev] = events(session_factory)
    assert ev.id == pending and ev.status == "retrying"


def test_purga_no_borra_evento_reencolado(session_factory, settings, clock, make_client):
    """Si un evento deja de ser final entre la selección y el borrado, no se borra."""
    from app import repository

    c = make_client(demo_mode=True)
    event_id = sim(c).json()["id"]
    deliver_all(session_factory, settings, clock, status=422)  # dead
    with session_factory() as s:
        real_scalars = s.scalars

        def scalars_then_replay(*a, **kw):  # simula un replay justo después del SELECT
            s.scalars = real_scalars  # solo la primera consulta (la selección de candidatos)
            ids = real_scalars(*a, **kw).all()
            with session_factory() as other:
                repository.replay(other, event_id, clock())
            return SimpleNamespace(all=lambda: ids)

        s.scalars = scalars_then_replay
        assert repository.purge_oldest_final(s, 1) == 0
    [ev] = events(session_factory)
    assert ev.status == "retrying"

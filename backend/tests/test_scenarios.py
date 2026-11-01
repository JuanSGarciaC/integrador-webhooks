"""Ciclo completo de cada escenario de la demo con reloj virtual: simulador → worker → destino."""
from datetime import timedelta

import httpx
import pytest

from app.config import Settings
from app.models import Event
from app.worker import process_once
from mock_downstream.main import MockDownstream
from tests.conftest import AUTH

FINAL = ("delivered", "dead")


@pytest.fixture
def demo_settings(settings):
    return Settings(**{**settings.__dict__, "demo_mode": True, "max_attempts": 4})


@pytest.fixture
def mock():
    return MockDownstream()


def simulate(make_client, scenario):
    r = make_client(demo_mode=True, max_attempts=4).post("/api/demo/simulate",
                                                         json={"scenario": scenario})
    assert r.status_code == 202
    return r.json()["id"]


def run_until_final(session_factory, settings, clock, mock, event_id, max_passes=10):
    http = httpx.Client(transport=httpx.MockTransport(mock.handle))
    for _ in range(max_passes):
        process_once(session_factory, settings, http, clock, jitter=lambda: 1.0)
        ev = load(session_factory, event_id)
        if ev.status in FINAL:
            return ev
        clock.now = max(clock.now, ev.next_attempt_at)
    raise AssertionError(f"no llegó a estado final: {ev.status}")


def load(session_factory, event_id):
    with session_factory() as s:
        ev = s.get(Event, event_id)
        ev.attempt_log  # carga el historial antes de cerrar la sesión
        return ev


@pytest.mark.parametrize("scenario,status,attempts", [
    ("ok", "delivered", 1),
    ("recover", "delivered", 3),
    ("rate_limit", "delivered", 2),
    ("timeout", "delivered", 2),
    ("rejected", "dead", 1),
])
def test_escenario_llega_al_estado_final(make_client, session_factory, demo_settings, clock, mock,
                                         scenario, status, attempts):
    event_id = simulate(make_client, scenario)
    ev = run_until_final(session_factory, demo_settings, clock, mock, event_id)
    assert (ev.status, len(ev.attempt_log)) == (status, attempts)


def test_rate_limit_respeta_retry_after(make_client, session_factory, demo_settings, clock, mock):
    event_id = simulate(make_client, "rate_limit")
    http = httpx.Client(transport=httpx.MockTransport(mock.handle))
    process_once(session_factory, demo_settings, http, clock, jitter=lambda: 1.0)
    ev = load(session_factory, event_id)
    assert ev.status == "retrying" and ev.attempt_log[0].http_status == 429
    assert ev.next_attempt_at == clock.now + timedelta(seconds=2)


def test_timeout_primer_intento_sin_http_status(make_client, session_factory, demo_settings,
                                                clock, mock):
    ev = run_until_final(session_factory, demo_settings, clock, mock,
                         simulate(make_client, "timeout"))
    assert ev.attempt_log[0].http_status is None and "Timeout" in ev.attempt_log[0].error


def test_rejected_reprocesado_se_entrega(make_client, session_factory, demo_settings, clock, mock):
    event_id = simulate(make_client, "rejected")
    assert run_until_final(session_factory, demo_settings, clock, mock, event_id).status == "dead"
    admin = make_client(headers=AUTH, demo_mode=True)
    assert admin.post(f"/api/events/{event_id}/replay").status_code == 200
    ev = run_until_final(session_factory, demo_settings, clock, mock, event_id)
    assert ev.status == "delivered" and len(ev.attempt_log) == 2
    assert mock.applied_count(event_id) == 1


def test_recover_aplica_el_efecto_una_sola_vez(make_client, session_factory, demo_settings,
                                               clock, mock):
    event_id = simulate(make_client, "recover")
    run_until_final(session_factory, demo_settings, clock, mock, event_id)
    assert mock.applied_count(event_id) == 1 and mock.duplicate_applications() == 0


def test_repos_no_demo_siguen_aleatorios():
    mock = MockDownstream(failure_rate=1.0, seed=1)
    assert mock.decide("k", {"repository": "yo/r"})[0] == 503


def test_memoria_del_mock_acotada():
    # La demo pública recibe simulaciones sin fin: el mock no puede crecer sin límite.
    mock = MockDownstream(max_keys=3)
    for i in range(10):
        mock.decide(f"k{i}", {"repository": "demo/ok"})
    assert len(mock.applied) <= 3 and len(mock.seen) <= 3 and len(mock.received) <= 3
    assert mock.applied_count("k9") == 1

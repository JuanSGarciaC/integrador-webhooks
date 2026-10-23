import json
from datetime import timedelta

import httpx
from sqlalchemy import select

from app.models import DeliveryAttempt, Event
from app.worker import process_once
from mock_downstream.main import MockDownstream
from tests.conftest import post_webhook

NO_JITTER = lambda: 1.0  # espera = tope de la ventana (determinista)


def make_http(statuses, seen=None, headers=None):
    """Destino simulado: responde `statuses` en orden (el último se repite)."""
    calls = []

    def handler(request: httpx.Request):
        i = min(len(calls), len(statuses) - 1)
        calls.append(request)
        st = statuses[i]
        if isinstance(st, Exception):
            raise st
        return httpx.Response(st, headers=(headers or {}))

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def run(session_factory, settings, http, clock):
    return process_once(session_factory, settings, http, clock, jitter=NO_JITTER)


def get_event(session_factory):
    with session_factory() as s:
        return s.scalars(select(Event)).one()


def attempts_of(session_factory):
    with session_factory() as s:
        return s.scalars(select(DeliveryAttempt).order_by(DeliveryAttempt.id)).all()


def test_entrega_a_la_primera(client, session_factory, settings, clock):
    post_webhook(client)
    http, calls = make_http([200])
    assert run(session_factory, settings, http, clock) == 1
    ev = get_event(session_factory)
    assert ev.status == "delivered" and ev.attempts == 1 and ev.delivered_at == clock.now
    req = calls[0]
    assert req.headers["Idempotency-Key"] == ev.id
    body = json.loads(req.content)
    assert body["event_id"] == ev.id and body["type"] == "push" and body["repository"] == "yo/r"
    assert "commits" not in body  # no se envía el payload completo


def test_entrega_tras_dos_fallos_con_misma_idempotency_key(client, session_factory, settings, clock):
    post_webhook(client)
    http, calls = make_http([500, 503, 200])
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "retrying" and ev.attempts == 1
    assert (ev.next_attempt_at - clock.now).total_seconds() == 2  # base * factor^0

    assert run(session_factory, settings, http, clock) == 0  # aún no vence
    clock.advance(2)
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "retrying" and (ev.next_attempt_at - clock.now).total_seconds() == 4

    clock.advance(4)
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "delivered" and ev.attempts == 3
    assert {c.headers["Idempotency-Key"] for c in calls} == {ev.id}
    assert [a.http_status for a in attempts_of(session_factory)] == [500, 503, 200]


def test_4xx_va_directo_a_dead(client, session_factory, settings, clock):
    post_webhook(client)
    http, calls = make_http([400])
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "dead" and ev.attempts == 1 and "400" in ev.last_error
    assert len(calls) == 1


def test_agotar_intentos_va_a_dead(client, session_factory, settings, clock):
    post_webhook(client)
    http, calls = make_http([500])
    for _ in range(settings.max_attempts):
        run(session_factory, settings, http, clock)
        clock.advance(settings.retry_cap_seconds)
    ev = get_event(session_factory)
    assert ev.status == "dead" and ev.attempts == settings.max_attempts
    assert len(calls) == settings.max_attempts


def test_timeout_se_reintenta_sin_http_status(client, session_factory, settings, clock):
    post_webhook(client)
    http, _ = make_http([httpx.ConnectTimeout("lento")])
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "retrying"
    a = attempts_of(session_factory)[0]
    assert a.http_status is None and "lento" in a.error


def test_429_respeta_retry_after(client, session_factory, settings, clock):
    post_webhook(client)
    http, _ = make_http([429], headers={"Retry-After": "30"})
    run(session_factory, settings, http, clock)
    ev = get_event(session_factory)
    assert ev.status == "retrying" and (ev.next_attempt_at - clock.now).total_seconds() == 30


def test_recupera_evento_con_bloqueo_vencido(client, session_factory, settings, clock):
    post_webhook(client)
    with session_factory() as s:
        ev = s.scalars(select(Event)).one()
        ev.status = "processing"
        ev.locked_until = clock.now + timedelta(minutes=5)
        s.commit()
    http, calls = make_http([200])
    assert run(session_factory, settings, http, clock) == 0  # bloqueo vigente
    clock.advance(10 * 60)  # el bloqueo vence
    assert run(session_factory, settings, http, clock) == 1
    assert get_event(session_factory).status == "delivered"


def test_no_toma_eventos_delivered_ni_dead(client, session_factory, settings, clock):
    post_webhook(client)
    http, _ = make_http([200])
    run(session_factory, settings, http, clock)
    clock.advance(1000)
    assert run(session_factory, settings, http, clock) == 0


def test_destino_simulado_aplica_la_misma_key_una_sola_vez():
    mock = MockDownstream(failure_rate=0.0, rate_limit_rate=0.0, seed=1)
    http = httpx.Client(transport=httpx.MockTransport(mock.handle))
    for _ in range(3):
        assert http.post("http://x/ingest", json={"a": 1}, headers={"Idempotency-Key": "k"}).status_code == 200
    assert mock.applied_count("k") == 1 and mock.duplicate_applications() == 0
    assert len(mock.received) == 1

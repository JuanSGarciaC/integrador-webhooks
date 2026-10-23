from datetime import datetime, timezone

from app.retry import Outcome, backoff_delay, classify, parse_retry_after


def test_backoff_sin_jitter_es_exponencial():
    full = lambda: 1.0  # jitter fijo = tope de la ventana
    assert backoff_delay(1, 2, 2, 300, full) == 2
    assert backoff_delay(2, 2, 2, 300, full) == 4
    assert backoff_delay(3, 2, 2, 300, full) == 8


def test_backoff_respeta_tope():
    assert backoff_delay(20, 2, 2, 300, lambda: 1.0) == 300


def test_jitter_completo_escala_la_ventana():
    assert backoff_delay(3, 2, 2, 300, lambda: 0.5) == 4
    assert backoff_delay(3, 2, 2, 300, lambda: 0.0) == 0


def test_clasificacion():
    assert classify(200) is Outcome.DELIVERED
    assert classify(204) is Outcome.DELIVERED
    assert classify(429) is Outcome.RETRY
    assert classify(500) is Outcome.RETRY
    assert classify(503) is Outcome.RETRY
    assert classify(None) is Outcome.RETRY  # timeout / conexion
    assert classify(400) is Outcome.DEAD
    assert classify(404) is Outcome.DEAD
    assert classify(422) is Outcome.DEAD


def test_retry_after_segundos():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert parse_retry_after("30", now) == 30


def test_retry_after_fecha_http():
    now = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert parse_retry_after("Thu, 01 Jan 2026 00:01:00 GMT", now) == 60


def test_retry_after_invalido_o_ausente():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert parse_retry_after(None, now) is None
    assert parse_retry_after("basura", now) is None
    assert parse_retry_after("-5", now) is None

"""Destino triaje-solicitudes (DOWNSTREAM_FORMAT=triaje): solo issues abiertos, con título y cuerpo."""
import json

import pytest
from sqlalchemy import select

from app.config import load_settings
from app.mapping import accepts, outbound, to_triaje
from app.models import Event
from app.worker import process_once
from tests.conftest import post_webhook
from tests.test_worker_flow import make_http

ISSUE = {"action": "opened", "issue": {"number": 7, "title": "No puedo entrar", "body": "Mi cuenta está bloqueada desde ayer."},
         "repository": {"full_name": "yo/r"}, "sender": {"login": "ana"}}


@pytest.fixture
def triaje(make_client):
    return make_client(downstream_format="triaje")


def stored(session_factory):
    with session_factory() as s:
        return s.scalars(select(Event)).all()


def test_mapeo_envia_titulo_cuerpo_y_usuario():
    assert to_triaje(ISSUE) == {"subject": "No puedo entrar", "body": "Mi cuenta está bloqueada desde ayer.",
                                "requester": "ana"}


def test_mapeo_recorta_y_rellena_cuerpo_vacio_o_corto():
    largo = to_triaje({"issue": {"title": "t" * 300, "body": "b" * 5000}})
    assert (len(largo["subject"]), len(largo["body"]), largo["requester"]) == (200, 4000, "github")
    assert to_triaje({"issue": {"title": "Sin cuerpo", "body": None}})["body"] == "(sin descripción)"
    assert to_triaje({"issue": {"title": "Corto", "body": "ayuda"}})["body"] == "ayuda (sin descripción)"


def test_accepts_solo_issues_abiertos_en_triaje():
    assert accepts("triaje", "issues", ISSUE)
    assert not accepts("triaje", "issues", {**ISSUE, "action": "closed"})
    assert not accepts("triaje", "push", {})
    assert accepts("", "push", {})


def test_outbound_por_defecto_sigue_siendo_el_resumen():
    assert outbound("", "e1", "issues", ISSUE, "t")["summary"] == "issue #7 opened: No puedo entrar"
    assert outbound("triaje", "e1", "issues", ISSUE, "t") == to_triaje(ISSUE)


def test_entrada_ignora_lo_que_no_es_issue_abierto(triaje, session_factory):
    r = post_webhook(triaje)  # push
    assert r.status_code == 200 and "ignorado" in r.json()["detail"]
    assert post_webhook(triaje, {**ISSUE, "action": "edited"}, event="issues", delivery="d-2").status_code == 200
    assert stored(session_factory) == []
    assert post_webhook(triaje, ISSUE, event="issues", delivery="d-3").status_code == 202
    assert len(stored(session_factory)) == 1


def test_worker_entrega_el_issue_con_idempotency_key(triaje, settings, session_factory, clock):
    event_id = post_webhook(triaje, ISSUE, event="issues").json()["id"]
    http, calls = make_http([201])
    cfg = type(settings)(**{**settings.__dict__, "downstream_format": "triaje"})
    process_once(session_factory, cfg, http, clock)
    assert json.loads(calls[0].content) == to_triaje(ISSUE)
    assert calls[0].headers["Idempotency-Key"] == event_id
    assert stored(session_factory)[0].status == "delivered"


def test_detalle_muestra_lo_enviado_al_destino(client, make_client):
    event_id = post_webhook(client).json()["id"]
    out = client.get(f"/api/events/{event_id}").json()["outbound"]
    assert out["event_id"] == event_id and out["summary"] == "1 commit(s) a refs/heads/main"


def test_demo_informa_el_destino(client, triaje):
    assert client.get("/api/demo").json() == {"demo": False, "destination": "mock"}
    assert triaje.get("/api/demo").json()["destination"] == "triaje"


def test_simular_issue_pasa_el_filtro_de_triaje(make_client, session_factory):
    demo = make_client(demo_mode=True, downstream_format="triaje")
    assert demo.post("/api/demo/simulate", json={"scenario": "issue"}).status_code == 202
    [ev] = stored(session_factory)
    assert ev.event_type == "issues" and accepts("triaje", "issues", json.loads(ev.payload))
    body = to_triaje(json.loads(ev.payload))
    assert len(body["subject"]) >= 3 and len(body["body"]) >= 10  # lo mínimo que triaje valida


def test_formato_desconocido_no_arranca(monkeypatch):
    monkeypatch.setenv("DOWNSTREAM_FORMAT", "triage")
    with pytest.raises(SystemExit):
        load_settings()

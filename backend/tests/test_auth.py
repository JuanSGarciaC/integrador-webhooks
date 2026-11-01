import pytest

from tests.conftest import AUTH, post_webhook

LECTURAS = ["/api/events", "/api/events/x", "/api/stats"]


@pytest.mark.parametrize("path", LECTURAS)
def test_lecturas_sin_token_401_fuera_de_demo(anon, path):
    r = anon.get(path)
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"
    assert r.json() == {"detail": "token ausente o inválido"}


@pytest.mark.parametrize("path", ["/api/events", "/api/stats"])
def test_lecturas_anonimas_200_en_demo(make_client, path):
    assert make_client(demo_mode=True).get(path).status_code == 200


@pytest.mark.parametrize("demo", [False, True])
def test_token_incorrecto_401_incluso_en_demo(make_client, demo):
    c = make_client(headers={"Authorization": "Bearer otro"}, demo_mode=demo)
    assert c.get("/api/events").status_code == 401


def test_esquema_distinto_de_bearer_401(make_client):
    c = make_client(headers={"Authorization": "Basic dGVzdC1hZG1pbg=="}, demo_mode=True)
    assert c.get("/api/events").status_code == 401


def test_replay_sin_token_401_en_demo(make_client):
    r = make_client(demo_mode=True).post("/api/events/x/replay")
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_admin_puede_todo(client):
    assert client.get("/api/events").status_code == 200
    assert client.get("/api/stats").status_code == 200
    assert client.post("/api/events/x/replay").status_code == 404


@pytest.mark.parametrize("header", ["Bearer ", "Bearer", "Bearer  "])
def test_admin_token_vacio_falla_cerrado(make_client, header):
    c = make_client(headers={"Authorization": header}, admin_token="", demo_mode=True)
    assert c.post("/api/events/x/replay").status_code == 401


def test_admin_token_vacio_sin_cabecera_tampoco_es_admin(make_client):
    assert make_client(admin_token="").get("/api/events").status_code == 401


def test_health_y_webhook_no_piden_token(anon):
    assert anon.get("/health").status_code == 200
    assert post_webhook(anon).status_code == 202


def test_token_con_otro_admin_valido(make_client):
    assert make_client(headers=AUTH).get("/api/stats").status_code == 200

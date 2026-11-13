import pytest

from app.config import Settings, check_demo_settings
from tests.conftest import post_webhook


@pytest.fixture
def panel(tmp_path, make_client):
    (tmp_path / "index.html").write_text("<h1>panel</h1>", encoding="utf-8")
    return make_client(demo_mode=True, static_dir=str(tmp_path))


def test_panel_servido_en_raiz(panel):
    r = panel.get("/")
    assert r.status_code == 200 and "panel" in r.text


def test_estaticos_no_tapan_api(panel):
    assert panel.get("/api/events").json()["total"] == 0
    assert panel.get("/api/demo").json()["demo"] is True
    assert panel.get("/health").json() == {"status": "ok"}
    assert panel.get("/docs").status_code == 200
    assert post_webhook(panel).status_code == 202


def test_sin_static_dir_no_monta(make_client):
    assert make_client(demo_mode=True).get("/").status_code == 404


def test_static_dir_fuera_de_demo_no_monta(tmp_path, make_client):
    (tmp_path / "index.html").write_text("x", encoding="utf-8")
    assert make_client(static_dir=str(tmp_path)).get("/").status_code == 404


@pytest.mark.parametrize("missing", ["webhook_secret", "admin_token"])
def test_demo_sin_secretos_no_arranca(missing):
    s = Settings(demo_mode=True, **{"webhook_secret": "s", "admin_token": "t", missing: ""})
    with pytest.raises(SystemExit):
        check_demo_settings(s)


def test_demo_con_secretos_y_modo_local_arrancan():
    check_demo_settings(Settings(demo_mode=True, webhook_secret="s", admin_token="t"))
    check_demo_settings(Settings())  # fuera de demo no se exige nada nuevo

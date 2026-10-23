import pytest

from app.mapping import UnsupportedEvent, normalize

REPO = {"full_name": "yo/pruebas"}
SENDER = {"login": "ana"}


def test_push():
    p = {"repository": REPO, "sender": SENDER, "ref": "refs/heads/main",
         "commits": [{}, {}], "head_commit": {"timestamp": "2026-01-01T10:00:00Z"}}
    n = normalize("e1", "push", p, "2026-01-02T00:00:00+00:00")
    assert n == {
        "event_id": "e1", "source": "github", "type": "push",
        "repository": "yo/pruebas", "actor": "ana",
        "summary": "2 commit(s) a refs/heads/main",
        "occurred_at": "2026-01-01T10:00:00Z",
    }


def test_issues():
    p = {"repository": REPO, "sender": SENDER, "action": "opened",
         "issue": {"number": 7, "title": "Bug", "created_at": "2026-01-01T09:00:00Z"}}
    n = normalize("e2", "issues", p, "x")
    assert n["summary"] == "issue #7 opened: Bug"
    assert n["occurred_at"] == "2026-01-01T09:00:00Z"


def test_pull_request():
    p = {"repository": REPO, "sender": SENDER, "action": "closed",
         "pull_request": {"number": 3, "title": "Fix", "updated_at": "2026-01-03T00:00:00Z"}}
    assert normalize("e3", "pull_request", p, "x")["summary"] == "PR #3 closed: Fix"


def test_ping_sin_repositorio_usa_received_at():
    n = normalize("e4", "ping", {"zen": "Keep it logically awesome.", "sender": SENDER},
                  "2026-01-02T00:00:00+00:00")
    assert n["repository"] is None
    assert n["summary"] == "ping: Keep it logically awesome."
    assert n["occurred_at"] == "2026-01-02T00:00:00+00:00"


def test_no_incluye_payload_completo():
    p = {"repository": REPO, "sender": SENDER, "ref": "r", "commits": [], "secreto": "x"}
    assert "secreto" not in str(normalize("e5", "push", p, "t"))


def test_tipo_no_soportado():
    with pytest.raises(UnsupportedEvent):
        normalize("e6", "fork", {}, "t")

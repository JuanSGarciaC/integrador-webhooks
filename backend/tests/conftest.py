import hashlib
import hmac
import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.database import make_engine, make_session_factory, init_db

SECRET = "test-secret"
ADMIN = "test-admin"
AUTH = {"Authorization": f"Bearer {ADMIN}"}


class FakeClock:
    """Reloj inyectable: las pruebas nunca usan la hora real ni sleep."""

    def __init__(self):
        self.now = datetime(2026, 1, 1, 12, 0, 0)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@pytest.fixture
def settings():
    return Settings(webhook_secret=SECRET, admin_token=ADMIN, database_url="sqlite://",
                    max_body_bytes=2000, retry_base_seconds=2, retry_factor=2,
                    retry_cap_seconds=300, max_attempts=3, lock_seconds=60)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def session_factory(settings):
    engine = make_engine(settings.database_url)
    init_db(engine)
    return make_session_factory(engine)


@pytest.fixture
def client(settings, session_factory, clock):
    """Cliente con token admin (la mayoría de pruebas no tratan de autorización)."""
    return TestClient(create_app(settings, session_factory, clock), headers=AUTH)


@pytest.fixture
def make_client(settings, session_factory, clock):
    """Construye un cliente con otros Settings; `headers` por defecto: ninguno (anónimo)."""
    def build(headers=None, **overrides):
        s = Settings(**{**settings.__dict__, **overrides})
        return TestClient(create_app(s, session_factory, clock), headers=headers or {})
    return build


@pytest.fixture
def anon(make_client):
    return make_client()


def post_webhook(client, payload=None, event="push", delivery="d-1", secret=SECRET,
                 raw: bytes | None = None, headers_extra=None):
    body = raw if raw is not None else json.dumps(
        payload if payload is not None else {"ref": "refs/heads/main", "commits": [{}],
                                             "repository": {"full_name": "yo/r"},
                                             "sender": {"login": "ana"}}).encode()
    headers = {"X-GitHub-Event": event, "X-GitHub-Delivery": delivery,
               "X-Hub-Signature-256": sign(body, secret), "Content-Type": "application/json"}
    headers.update(headers_extra or {})
    return client.post("/webhooks/github", content=body, headers=headers)

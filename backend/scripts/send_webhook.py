"""Envía un webhook firmado de ejemplo.

  python scripts/send_webhook.py [push|issues|pull_request|ping] [--url URL] [--delivery ID]
Lee WEBHOOK_SECRET del entorno o de .env.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import uuid

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import load_dotenv  # noqa: E402

SAMPLES = {
    "push": {"ref": "refs/heads/main", "commits": [{"id": "abc"}],
             "repository": {"full_name": "usuario/repo-de-pruebas"}, "sender": {"login": "usuario"},
             "head_commit": {"timestamp": "2026-01-01T10:00:00Z"}},
    "issues": {"action": "opened", "issue": {"number": 1, "title": "Ejemplo",
                                              "created_at": "2026-01-01T10:00:00Z"},
               "repository": {"full_name": "usuario/repo-de-pruebas"}, "sender": {"login": "usuario"}},
    "pull_request": {"action": "opened", "pull_request": {"number": 2, "title": "Ejemplo",
                                                           "updated_at": "2026-01-01T10:00:00Z"},
                     "repository": {"full_name": "usuario/repo-de-pruebas"}, "sender": {"login": "usuario"}},
    "ping": {"zen": "Keep it logically awesome.", "sender": {"login": "usuario"}},
}


def main() -> int:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("event", nargs="?", default="push", choices=SAMPLES)
    ap.add_argument("--url", default="http://127.0.0.1:8000/webhooks/github")
    ap.add_argument("--delivery", default=str(uuid.uuid4()))
    a = ap.parse_args()
    secret = os.environ.get("WEBHOOK_SECRET", "")
    if not secret:
        print("Falta WEBHOOK_SECRET (entorno o .env)", file=sys.stderr)
        return 2
    body = json.dumps(SAMPLES[a.event]).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    r = httpx.post(a.url, content=body, timeout=10, headers={
        "Content-Type": "application/json", "X-GitHub-Event": a.event,
        "X-GitHub-Delivery": a.delivery, "X-Hub-Signature-256": sig})
    print(r.status_code, r.text)
    return 0 if r.status_code in (200, 202) else 1


if __name__ == "__main__":
    sys.exit(main())

"""Medición con fallos inyectados (sección 16 del diseño).

  python scripts/simulate_load.py [-n 200] [--seed 42] [--out ../docs/load-results.md]

Corre todo en proceso: API real (TestClient) + worker real + destino simulado por
httpx.MockTransport + SQLite en archivo temporal. El reloj es VIRTUAL: en vez de dormir,
avanza hasta el siguiente `next_attempt_at`, así que los tiempos de entrega son tiempo
simulado bajo la política de reintentos configurada, NO latencia de red medida.
"""
import argparse
import hashlib
import hmac
import json
import os
import platform
import random
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import func, select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.api import create_app  # noqa: E402
from app.config import Settings  # noqa: E402
from app.database import init_db, make_engine, make_session_factory  # noqa: E402
from app.models import Event  # noqa: E402
from app import repository  # noqa: E402
from app.worker import process_once  # noqa: E402
from mock_downstream.main import MockDownstream  # noqa: E402

SECRET = "load-test-secret"
LOST_ACK_SHARE = 0.5


class VirtualClock:
    def __init__(self):
        self.now = datetime(2026, 1, 1, 12, 0, 0)

    def __call__(self):
        return self.now


def run_scenario(n: int, failure_rate: float, seed: int, settings_base: Settings) -> dict:
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        settings = Settings(**{**settings_base.__dict__,
                               "database_url": f"sqlite:///{tmp}/load.db",
                               "webhook_secret": SECRET, "max_body_bytes": 1_000_000})
        engine = make_engine(settings.database_url)
        init_db(engine)
        factory = make_session_factory(engine)
        clock = VirtualClock()
        client = TestClient(create_app(settings, factory, clock))
        mock = MockDownstream(failure_rate=failure_rate, seed=seed, lost_ack_share=LOST_ACK_SHARE)
        http = httpx.Client(transport=httpx.MockTransport(mock.handle))
        rng = random.Random(seed)

        for i in range(n):
            body = json.dumps({"ref": "refs/heads/main", "commits": [{}], "repository":
                               {"full_name": "sim/repo"}, "sender": {"login": "sim"}}).encode()
            sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
            r = client.post("/webhooks/github", content=body, headers={
                "X-GitHub-Event": "push", "X-GitHub-Delivery": f"sim-{failure_rate}-{i}",
                "X-Hub-Signature-256": sig})
            assert r.status_code == 202, r.text

        while True:
            if process_once(factory, settings, http, clock, jitter=rng.random):
                continue
            with factory() as s:
                nxt = s.scalar(select(func.min(Event.next_attempt_at)).where(
                    Event.status.in_(("received", "retrying"))))
                locked = s.scalar(select(func.min(Event.locked_until)).where(
                    Event.status == "processing"))
            candidates = [t for t in (nxt, locked) if t]
            if not candidates:
                break
            clock.now = max(clock.now, min(candidates)) + timedelta(milliseconds=1)

        with factory() as s:
            st = repository.stats(s)
        http.close()
        engine.dispose()
        return {"failure_rate": failure_rate, "n": n, "stats": st,
                "dup": mock.duplicate_applications(), "redundant": mock.redundant_requests,
                "applied": len(mock.applied)}


def render(results: list[dict], n: int, seed: int, s: Settings) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = [f"## Resultados de `simulate_load.py` ({today})", "",
           f"- Equipo: {platform.platform()} · Python {platform.python_version()}",
           f"- N = {n} eventos por escenario · semilla = {seed} · destino SIMULADO "
           f"(la mitad de los fallos son 'ack perdido': el destino aplica el efecto y responde 503)",
           f"- Reintentos: base {s.retry_base_seconds}s, factor {s.retry_factor}, tope "
           f"{s.retry_cap_seconds}s, jitter completo, máx. {s.max_attempts} intentos",
           "- Tiempos en reloj VIRTUAL (tiempo simulado según la política, no latencia medida)", "",
           "| Fallos inyectados | Entregados / total | `dead` | Intentos prom. | p50 (s) | p95 (s) "
           "| Aplicados en destino | Reentregas absorbidas | Duplicados efectivos |",
           "|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        st = r["stats"]
        d = st["delivery_seconds"]
        fmt = lambda v: "—" if v is None else f"{v:.1f}"
        out.append(f"| {int(r['failure_rate'] * 100)}% | {st['by_status']['delivered']} / {st['total']} "
                   f"| {st['by_status']['dead']} | {st['avg_attempts']} | {fmt(d['p50'])} | {fmt(d['p95'])} "
                   f"| {r['applied']} | {r['redundant']} | {r['dup']} |")
    out += ["", "«Duplicados efectivos» es 0 por construcción del destino simulado idempotente; "
            "lo que demuestra la idempotencia es que «Reentregas absorbidas» > 0 sin duplicar el efecto."]
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out")
    a = ap.parse_args()
    base = Settings()
    results = [run_scenario(a.n, rate, a.seed, base) for rate in (0.0, 0.3, 0.6)]
    text = render(results, a.n, a.seed, base)
    print(text)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()

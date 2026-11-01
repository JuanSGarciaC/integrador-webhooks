"""Exporta el contrato: python scripts/export_openapi.py ../docs/openapi.json
Con --check falla (exit 1) si el archivo difiere de lo generado (para CI)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.api import create_app  # noqa: E402
from app.config import Settings  # noqa: E402
from app.database import init_db, make_engine, make_session_factory  # noqa: E402
from app.worker import utc_now  # noqa: E402


def generate() -> str:
    engine = make_engine("sqlite://")
    init_db(engine)
    # demo_mode=True para que el contrato incluya también /api/demo/simulate
    app = create_app(Settings(demo_mode=True), make_session_factory(engine), utc_now)
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    check = "--check" in sys.argv
    path = [a for a in sys.argv[1:] if not a.startswith("--")][0]
    text = generate()
    if check:
        current = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        if current != text:
            print("openapi.json desactualizado: ejecuta scripts/export_openapi.py", file=sys.stderr)
            sys.exit(1)
    else:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

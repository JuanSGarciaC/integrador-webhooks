#!/usr/bin/env bash
# Arranque de la demo en un solo contenedor: destino simulado, worker y API (+ panel).
# Si cualquiera de los tres procesos termina, el contenedor sale y la plataforma lo reinicia.
set -euo pipefail

# Crear las tablas una sola vez antes de lanzar API y worker (evita la carrera en create_all).
python -c "from app.config import load_settings; from app.database import make_engine, init_db; init_db(make_engine(load_settings().database_url))"

# bash es PID 1: sin trap no reenvía SIGTERM y cada redeploy esperaría al SIGKILL.
trap 'kill 0' TERM INT

uvicorn mock_downstream.main:app --host 127.0.0.1 --port 9000 --log-level warning &
python -m app.worker &
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --log-level warning &

wait -n
echo "un proceso de la demo terminó; saliendo" >&2
exit 1

# Integrador de webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Servicio que recibe webhooks de GitHub, verifica firma, persiste, entrega a un destino simulado con reintentos y cola de fallidos reprocesable, con API, panel y documentación.

**Architecture:** FastAPI + SQLite (outbox como cola). Worker aparte que toma eventos vencidos, normaliza y hace POST con `Idempotency-Key`. Reloj y jitter inyectables.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, httpx, pytest; React+Vite+TS; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-integrador-webhooks-design.md`

## Global Constraints
- Firma HMAC-SHA256 sobre cuerpo crudo, `X-Hub-Signature-256: sha256=<hex>`, `hmac.compare_digest`.
- Estados: received, processing, retrying, delivered, dead. Reintentos: base 2 s, factor 2, tope 300 s, jitter completo, máx 6 intentos, todo en `config.py`.
- Sin `sleep` ni hora real en tests; secretos solo en `.env`.
- Semántica al-menos-una-vez; no inventar métricas.

## Review Focus
- Firma con mayúsculas/sin prefijo `sha256=` -> 401.
- Cuerpo > límite -> 413 antes de parsear.
- JSON inválido con firma válida -> 400; evento no soportado -> 400.
- Evento `processing` con bloqueo vencido se recupera.
- `Retry-After` en 429 respetado.

## Tasks
- [ ] T1 security.py + test_security (firma válida/inválida/ausente/mayúsculas)
- [ ] T2 retry.py + test_retry (backoff determinista, clasificación HTTP, Retry-After)
- [ ] T3 mapping.py + test_mapping (push/issues/pull_request/ping)
- [ ] T4 config, database, models, repository + webhook API + test_webhook_api (202/200/401/413/400)
- [ ] T5 worker.py + mock_downstream + test_worker_flow (entrega, 2 fallos, 4xx dead, agotar, lock vencido, misma Idempotency-Key)
- [ ] T6 API consulta/replay/stats + test_replay (409 si no dead)
- [ ] T7 scripts send_webhook / simulate_load; medición real
- [ ] T8 Panel React (Events, EventDetail, DeadLetters, Stats)
- [ ] T9 docs/ analista, README, AGENTS.md, CI, openapi.json

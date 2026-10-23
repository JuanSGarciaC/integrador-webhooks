# Plan de pruebas

Ejecutar: `cd backend && pytest --cov=app` · Contrato: `npx newman run docs/postman/integrador.postman_collection.json` (con la API en el puerto 8000 y `WEBHOOK_SECRET=newman-secret`).

| Nivel | Archivo | Qué cubre | Criterios |
|---|---|---|---|
| Unitarias | `test_security.py` | firma válida, inválida, ausente, sin prefijo, hex en mayúsculas, cuerpo alterado, secreto vacío | HU-01 |
| Unitarias | `test_retry.py` | espera exponencial con jitter inyectado, tope, clasificación HTTP, `Retry-After` (segundos y fecha) | HU-06, HU-07 |
| Unitarias | `test_mapping.py` | normalización de cada tipo, sin payload completo, tipo no soportado | HU-05 |
| Integración | `test_webhook_api.py` | `202`, `401`, `200` duplicado, `413`, `400` (JSON inválido, no objeto, tipo no soportado, sin delivery id) | HU-01–04 |
| Flujo del worker | `test_worker_flow.py` | entrega a la primera; entrega tras 2 fallos; `4xx`→dead; agotar intentos; timeout; `429` con `Retry-After`; bloqueo vencido; misma `Idempotency-Key`; idempotencia del destino | HU-05–09 |
| Reproceso y consulta | `test_replay.py` | dead→retrying→delivered; `409`; `404`; filtros y paginación; `422`; estadísticas | HU-10, HU-11 |
| Contrato | Newman (11 aserciones) + `--check` de `openapi.json` | rutas y códigos de la API | HU-12 |
| Fallos inyectados | `scripts/simulate_load.py` | 0 %, 30 %, 60 % de fallos; resultados en `load-results.md` | HU-06, HU-08 |

Las pruebas no usan `sleep` ni la hora real: `FakeClock` y jitter fijo.

# Plan de pruebas

Ejecutar: `cd backend && pytest --cov=app` · Contrato: `npx newman run docs/postman/integrador.postman_collection.json` (con la API en el puerto 8000, `WEBHOOK_SECRET=newman-secret` y `ADMIN_TOKEN=newman-admin`) · E2E: ver la sección del final.

| Nivel | Archivo | Qué cubre | Criterios |
|---|---|---|---|
| Unitarias | `test_security.py` | firma válida, inválida, ausente, sin prefijo, hex en mayúsculas, cuerpo alterado, secreto vacío | HU-01 |
| Unitarias | `test_retry.py` | espera exponencial con jitter inyectado, tope, clasificación HTTP, `Retry-After` (segundos y fecha) | HU-06, HU-07 |
| Unitarias | `test_mapping.py` | normalización de cada tipo, sin payload completo, tipo no soportado | HU-05 |
| Integración | `test_webhook_api.py` | `202`, `401`, `200` duplicado, `413`, `400` (JSON inválido, no objeto, tipo no soportado, sin delivery id) | HU-01–04 |
| Flujo del worker | `test_worker_flow.py` | entrega a la primera; entrega tras 2 fallos; `4xx`→dead; agotar intentos; timeout; `429` con `Retry-After`; bloqueo vencido; misma `Idempotency-Key`; idempotencia del destino | HU-05–09 |
| Reproceso y consulta | `test_replay.py` | dead→retrying→delivered; `409`; `404`; filtros y paginación; `422`; estadísticas | HU-10, HU-11 |
| Autorización | `test_auth.py` | matriz de roles: lectura sin token `401` / en demo `200`, token incorrecto `401` también en demo, esquema no Bearer, replay solo admin, `ADMIN_TOKEN` vacío falla cerrado | Demo §2 |
| Simulador | `test_simulate.py` | evento ficticio por el camino del webhook, `422`, `404` fuera de demo, límite por IP, `X-Forwarded-For` falseado, cabecera fiable, tope con purga solo de finales, purga que no borra un evento reprocesado a mitad | Demo §3 |
| Escenarios | `test_scenarios.py` | los 5 escenarios llegan a su estado final con el número de intentos esperado; `Retry-After`; timeout sin `http_status`; `rejected` reprocesado se entrega con el efecto aplicado una vez | Demo §3 |
| Imagen de demo | `test_demo_app.py` | panel en `/` sin tapar `/api`, `/docs`, `/health` ni el webhook; arranque bloqueado sin secretos | Demo §5 |
| Contrato | Newman (13 aserciones, incluidas `401` sin token y con token incorrecto) + `--check` de `openapi.json` | rutas y códigos de la API | HU-12 |
| Fallos inyectados | `scripts/simulate_load.py` | 0 %, 30 %, 60 % de fallos; resultados en `load-results.md` | HU-06, HU-08 |

Las pruebas no usan `sleep` ni la hora real: `FakeClock` y jitter fijo.

## Matriz E2E de la demo (tiempo real, contra el contenedor)

Se ejecuta contra la **misma imagen que se despliega**: `docker run ... integrador-demo`, luego `pytest tests_e2e` y `npm run e2e`. Estas pruebas usan el reloj real y sondean con un plazo máximo de 60 s, así que están separadas de las unitarias, que usan reloj virtual.

| Endpoint / flujo | Escenario | Esperado | Observado (local, 2026-11-01) | Evidencia | Resultado |
|---|---|---|---|---|---|
| `POST /api/demo/simulate` → worker → destino | `ok` | `delivered`, intentos `[200]` | igual | `test_escenario_extremo_a_extremo[ok]` | ✅ |
| ídem | `recover` | `delivered`, `[503, 503, 200]` | igual | `[recover]` · Playwright «simular recuperación» | ✅ |
| ídem | `rate_limit` | `delivered`, `[429, 200]` | igual | `[rate_limit]` | ✅ |
| ídem | `timeout` | `delivered`, `[sin respuesta, 200]` | igual | `[timeout]` | ✅ |
| ídem | `rejected` | `dead`, `[422]` | igual | `[rejected]` | ✅ |
| `POST /api/events/{id}/replay` | anónimo, después admin | `401` + `WWW-Authenticate`; con token `200` y luego `delivered` con 2 intentos | igual | `test_replay_sin_token_401_y_con_token_entrega` · Playwright «reprocesar requiere admin» | ✅ |
| `POST /webhooks/github` | firmado y reenviado | `202`, luego `200` sin registro nuevo | igual | `test_webhook_firmado_y_duplicado` | ✅ |
| `POST /webhooks/github` | firma incorrecta | `401` | igual | `test_firma_invalida_401` | ✅ |
| `GET /api/events` | token incorrecto | `401` | igual | `test_token_incorrecto_401` | ✅ |
| Panel | token admin guardado | nunca en `localStorage` | igual | Playwright «el token no se guarda en localStorage» | ✅ |
| `/api/*` fuera de demo | sin token / token malo | `401` | igual | Newman, job `contract` | ✅ |

En CI corre el job `e2e` de `.github/workflows/ci.yml`. Primera ejecución en verde de los cuatro jobs (`backend`, `contract`, `frontend`, `e2e`): [run 41333053308](https://github.com/JuanSGarciaC/integrador-webhooks/actions/runs/41333053308), 2026-11-01.

## Verificación en la demo desplegada (https://integrador-webhooks-demo.onrender.com, 2026-11-01)

| Comprobación | Esperado | Observado | Resultado |
|---|---|---|---|
| `GET /health` · `GET /api/demo` · panel en `/` · `/docs` | `200` · `{"demo": true}` · `200` · `200` | igual | ✅ |
| Simular `recover` | `delivered`, intentos `[503, 503, 200]` | igual | ✅ |
| Simular `rejected` | `dead`, `[422]` | igual | ✅ |
| Replay anónimo · lectura con token incorrecto | `401` · `401` | igual | ✅ |
| Límite por IP con `True-Client-IP` falseado distinto en cada petición | `429` al superar 10/min | 10 aceptadas (2 previas + 8) y después `429` en las 4 restantes: Cloudflare sobrescribe la cabecera, así que el visitante no puede falsearla | ✅ |

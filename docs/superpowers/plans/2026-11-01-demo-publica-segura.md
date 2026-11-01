# Demo pública segura — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar una demo del integrador que un visitante usa sin configurar nada (simulador de escenarios), con `/api/*` protegido por token admin, en un único contenedor Docker probado de punta a punta en CI.

**Architecture:** Se añaden `app/auth.py` (dependencias FastAPI de lectura/admin) y `app/demo.py` (escenarios, payload ficticio, límite por IP); `create_app` extrae la ingesta a una función compartida que usan el webhook y el simulador. `MockDownstream` responde por escenario según `repository = "demo/<escenario>"`. Un script arranca destino, worker y API en un contenedor que también sirve el panel.

**Tech Stack:** FastAPI, SQLAlchemy, httpx, pytest (existente); React + Vite (existente); nuevo: `@playwright/test` (dev), Docker, Render (blueprint).

**Spec:** `docs/superpowers/specs/2026-11-01-demo-publica-segura-design.md`

## Global Constraints

- Sin dependencias nuevas en `backend/requirements.txt`. Única dependencia nueva: `@playwright/test` en `frontend` (devDependencies).
- Pruebas en `backend/tests/`: nada de `sleep` ni hora real; reloj `FakeClock` y `httpx.MockTransport` (ver `tests/test_worker_flow.py`).
- Ningún secreto en código, README, logs ni bundle del panel. `WEBHOOK_SECRET` y `ADMIN_TOKEN` solo por entorno.
- Errores HTTP con cuerpo `{"detail": "<texto en español>"}`; `401` lleva `WWW-Authenticate: Bearer`.
- Variables nuevas: `ADMIN_TOKEN=""`, `DEMO_MODE=false`, `DEMO_RATE_PER_MINUTE=10`, `DEMO_MAX_EVENTS=500`, `STATIC_DIR=""`.
- Escenarios exactos: `ok`, `recover`, `rate_limit`, `timeout`, `rejected`.
- Valores de demo en la imagen: `RETRY_BASE_SECONDS=1`, `RETRY_CAP_SECONDS=10`, `MAX_ATTEMPTS=4`, `POLL_INTERVAL_SECONDS=0.5`, `HTTP_TIMEOUT_SECONDS=2`, `DATABASE_URL=sqlite:////tmp/webhooks.db`.
- Textos de UI y comentarios en español. Seguir `AGENTS.md` (explicar cada cambio, TDD).
- La carpeta local no es repo git: los pasos «Commit» se hacen en el clon de GitHub; si se trabaja sin git, se omiten.

## Review Focus

1. `ADMIN_TOKEN` vacío + cabecera `Authorization: Bearer ` (token vacío) ⇒ debe ser `401`, nunca admin (`compare_digest("", "")` es `True`). Prueba en Task 1.
2. Visitante que envía su propio `X-Forwarded-For` para esquivar el límite ⇒ sigue limitado (se usa el **último** valor). Prueba en Task 3.
3. La purga por tope nunca borra eventos en `received`/`processing`/`retrying`. Prueba en Task 3.
4. El panel estático montado en `/` no tapa `/api/*`, `/webhooks/github`, `/docs` ni `/health`. Prueba en Task 5.
5. `rejected` reprocesado debe acabar en `delivered` aunque el mock ya vio esa `Idempotency-Key`. Prueba en Task 4.

---

### Task 1: Configuración y autorización de `/api/*`

**Files:**
- Modify: `backend/app/config.py` (campos y `load_settings`)
- Create: `backend/app/auth.py`
- Modify: `backend/app/api.py` (dependencias en rutas `/api/*`)
- Modify: `backend/tests/conftest.py` (fixture `client` con token admin; `ADMIN = "test-admin"`)
- Create: `backend/tests/test_auth.py`
- Modify: `.env.example`, `docs/postman/integrador.postman_collection.json`

**Interfaces:**
- Produces: `Settings.admin_token: str = ""`, `Settings.demo_mode: bool = False`, `Settings.demo_rate_per_minute: int = 10`, `Settings.demo_max_events: int = 500`, `Settings.static_dir: str = ""`. `load_settings` lee `DEMO_MODE` como verdadero si es `1/true/yes` (sin distinguir mayúsculas).
- Produces (`app/auth.py`): `is_admin(settings: Settings, request: Request) -> bool`; `reader(settings) -> Callable` y `admin(settings) -> Callable`, dependencias FastAPI que lanzan `HTTPException(401, "token ausente o inválido", headers={"WWW-Authenticate": "Bearer"})`.
- Regla de `reader`: pasa si `is_admin`; si no, pasa solo si `demo_mode` **y** no hay cabecera `Authorization`. Token presente e incorrecto ⇒ 401 siempre.
- Produces (conftest): `ADMIN`, `AUTH = {"Authorization": f"Bearer {ADMIN}"}`, fixture `settings` con `admin_token=ADMIN`; fixture `client` envía `AUTH` por defecto (`TestClient(..., headers=AUTH)`); nueva fixture `anon` (TestClient sin cabeceras) y `make_client(**overrides)` para construir apps con otros `Settings`.

- [ ] **Step 1: Escribir `tests/test_auth.py`** con la matriz del spec §2 (parametrizada):
  - `test_lecturas_sin_token_401_fuera_de_demo` — `GET /api/events`, `/api/events/x`, `/api/stats` ⇒ 401 y cabecera `WWW-Authenticate == "Bearer"`.
  - `test_lecturas_anonimas_200_en_demo` — con `demo_mode=True`: `/api/events` y `/api/stats` ⇒ 200.
  - `test_token_incorrecto_401_incluso_en_demo` — `Authorization: Bearer otro` ⇒ 401.
  - `test_replay_sin_token_401_en_demo` — `POST /api/events/x/replay` anónimo con `demo_mode=True` ⇒ 401.
  - `test_admin_puede_todo` — con `AUTH`: lecturas 200, replay de inexistente ⇒ 404.
  - `test_admin_token_vacio_falla_cerrado` — `admin_token=""`, cabecera `Bearer ` y `Bearer` ⇒ 401 en replay.
  - `test_health_y_webhook_no_piden_token` — `GET /health` 200 y `post_webhook(anon)` 202.
- [ ] **Step 2:** `cd backend && pytest tests/test_auth.py -v` ⇒ FAIL.
- [ ] **Step 3: Implementar** `auth.py` con `hmac.compare_digest` sobre bytes y retorno `False` si `admin_token` vacío; añadir `dependencies=[Depends(reader(settings))]` a las GET de `/api/*` y `Depends(admin(settings))` a replay. Campos en `config.py`.
- [ ] **Step 4:** `pytest -q` ⇒ todo verde (las pruebas existentes pasan gracias al fixture con token).
- [ ] **Step 5: `.env.example`** añade `ADMIN_TOKEN=cambia-este-token` y comentario de `DEMO_MODE`. **Postman:** variable `adminToken` = `newman-admin`, `auth` de colección tipo bearer `{{adminToken}}`; ítems nuevos «Listar sin token -> 401» y «Token incorrecto -> 401» (auth `noauth` / bearer `malo`). En `ci.yml` job `contract`: `ADMIN_TOKEN: newman-admin`.
- [ ] **Step 6: Commit** `feat(auth): token admin para /api/* y lectura anónima solo en demo`.

### Task 2: Ingesta compartida, simulador y `GET /api/demo`

**Files:**
- Create: `backend/app/demo.py`
- Modify: `backend/app/api.py`, `backend/app/schemas.py`
- Modify: `backend/scripts/export_openapi.py` (generar con `Settings(demo_mode=True)`), `docs/openapi.json` (regenerado)
- Create: `backend/tests/test_simulate.py`

**Interfaces:**
- Consumes: Task 1 (`reader`, `Settings.demo_mode`).
- Produces (`app/demo.py`): `Scenario = Literal["ok","recover","rate_limit","timeout","rejected"]`; `build_payload(scenario: str) -> bytes` (JSON `push` con `ref="refs/heads/main"`, `commits=[{}]`, `repository.full_name=f"demo/{scenario}"`, `sender.login="visitante-demo"`).
- Produces (`schemas.py`): `SimulateIn(BaseModel): scenario: Scenario`; `DemoInfo(BaseModel): demo: bool`.
- Produces (`api.py`): función interna `async def ingest(body: bytes, headers) -> JSONResponse` con **toda** la lógica actual del handler (413, firma, 400s, duplicado 200, 202). `github_webhook` queda `return await ingest(await request.body(), request.headers)` más la comprobación previa de `content-length`.
- Endpoints: `GET /api/demo` ⇒ `{"demo": bool}` sin auth (siempre existe). `POST /api/demo/simulate` (status 202, tag `demo`) solo registrado si `settings.demo_mode`; firma `build_payload(...)` con `settings.webhook_secret`, `X-GitHub-Event: push`, `X-GitHub-Delivery: str(uuid4())` y llama a `ingest`.

- [ ] **Step 1: Pruebas** en `test_simulate.py`:
  - `test_simular_crea_evento_por_el_camino_del_webhook` — demo on, `POST /api/demo/simulate {"scenario":"recover"}` ⇒ 202 con `id`; el evento guardado tiene `event_type == "push"` y `json.loads(payload)["repository"]["full_name"] == "demo/recover"`.
  - `test_cada_simulacion_es_un_evento_nuevo` — dos llamadas ⇒ 2 eventos con `delivery_id` distintos.
  - `test_escenario_desconocido_422` y `test_cuerpo_invalido_422`.
  - `test_simulate_no_existe_fuera_de_demo` ⇒ 404 incluso con `AUTH`.
  - `test_demo_info` — `GET /api/demo` anónimo ⇒ `{"demo": false}` / `{"demo": true}`.
  - `test_webhook_sigue_igual` — las pruebas de `test_webhook_api.py` siguen pasando sin cambios.
- [ ] **Step 2:** `pytest tests/test_simulate.py -v` ⇒ FAIL.
- [ ] **Step 3: Implementar** según Interfaces. Usar `sign` equivalente a `conftest.sign` (`"sha256=" + hmac hexdigest`).
- [ ] **Step 4:** `pytest -q` ⇒ verde; `python scripts/export_openapi.py ../docs/openapi.json` y luego `--check` ⇒ exit 0.
- [ ] **Step 5: Commit** `feat(demo): simulador de escenarios por el mismo camino que el webhook`.

### Task 3: Límite por IP y tope de eventos con purga

**Files:**
- Modify: `backend/app/demo.py`, `backend/app/api.py`, `backend/app/repository.py`
- Modify: `backend/tests/test_simulate.py`

**Interfaces:**
- Produces (`demo.py`): `client_ip(request: Request) -> str` (último valor no vacío de `X-Forwarded-For` separado por comas, con `strip`; si no hay, `request.client.host`); `class RateLimiter: __init__(self, per_minute: int, clock: Callable[[], datetime])`, `allow(self, key: str) -> bool` — ventana fija por minuto (`clock().replace(second=0, microsecond=0)`), descarta ventanas viejas. Comentario `# shortcut: en memoria y por proceso, válido con un solo contenedor; usar Redis si hay varias réplicas`.
- Produces (`repository.py`): `count_events(s: Session) -> int`; `purge_oldest_final(s: Session, n: int) -> int` — borra los `n` eventos más antiguos (`received_at`) con `status in ("delivered","dead")` **y sus `DeliveryAttempt`** (borrar intentos primero o vía ORM `s.delete` para respetar el cascade), commit, devuelve cuántos borró.
- Comportamiento en `simulate`: 1) `RateLimiter.allow(client_ip)` falso ⇒ `429 {"detail": "demasiadas simulaciones, espera un minuto"}`; 2) si `count_events >= demo_max_events` ⇒ `purge_oldest_final(s, count - demo_max_events + 1)`; si aún no hay hueco ⇒ `429 {"detail": "demo llena, prueba en un minuto"}`.

- [ ] **Step 1: Pruebas:**
  - `test_limite_por_ip` — `demo_rate_per_minute=2`: 3.ª llamada ⇒ 429; `clock.advance(60)` ⇒ 202 otra vez.
  - `test_x_forwarded_for_falseado_no_esquiva` — con límite 1, peticiones con `X-Forwarded-For: "1.1.1.1, 9.9.9.9"` y luego `"2.2.2.2, 9.9.9.9"` ⇒ la segunda 429.
  - `test_ips_distintas_no_se_afectan` — último valor distinto ⇒ ambas 202.
  - `test_tope_purga_el_final_mas_antiguo` — `demo_max_events=2`, dos eventos marcados `delivered` (vía worker con `make_http([200])` o actualizando en sesión); la 3.ª simulación ⇒ 202, total sigue 2, el más antiguo y sus intentos ya no existen.
  - `test_tope_no_purga_pendientes` — `demo_max_events=1`, un evento en `retrying` ⇒ 429 «demo llena» y el evento sigue ahí.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** implementar. **Step 4:** `pytest -q` ⇒ verde.
- [ ] **Step 5: Commit** `feat(demo): límite por IP y purga de eventos finales al llegar al tope`.

### Task 4: Destino simulado por escenario y ciclo completo con reloj virtual

**Files:**
- Modify: `backend/mock_downstream/main.py`
- Create: `backend/tests/test_scenarios.py`

**Interfaces:**
- Produces (`MockDownstream`): `self.seen: dict[str, int]` (intentos por key en escenarios demo); `scenario_response(self, key: str, repository: str) -> tuple[int | None, dict]` con `n = seen[key]` antes de incrementar:
  - `demo/ok` ⇒ `(200, {})`
  - `demo/recover` ⇒ `503` si `n < 2`, si no `200`
  - `demo/rate_limit` ⇒ `(429, {"Retry-After": "2"})` si `n == 0`, si no `200`
  - `demo/timeout` ⇒ `(None, {})` si `n == 0` (= no responder), si no `200`
  - `demo/rejected` ⇒ `422` si `n == 0`, si no `200`
  - `decide()` llama a `scenario_response` cuando `str(body.get("repository") or "").startswith("demo/")` y aplica el efecto (`_apply`) en 2xx; si no, lógica actual sin cambios.
- `handle()` (MockTransport): si status es `None` ⇒ `raise httpx.ReadTimeout("simulado", request=request)`.
- `create_mock_app`: si status es `None` ⇒ `await asyncio.sleep(float(os.environ.get("SLOW_SECONDS", 3)))` y responde 200 (el worker ya cortó por timeout).

- [ ] **Step 1: Pruebas** en `test_scenarios.py` (usar `anon`/`client` demo + `process_once` con `httpx.Client(transport=httpx.MockTransport(mock.handle))`, `FakeClock`, `jitter=lambda: 1.0`, avanzando el reloj entre pasadas hasta estado final, máx. 10 pasadas):
  - parametrizada `test_escenario_llega_al_estado_final` con `(scenario, status, intentos)`: `ok→delivered,1`, `recover→delivered,3`, `rate_limit→delivered,2`, `timeout→delivered,2`, `rejected→dead,1`. Settings con `max_attempts=4`.
  - `test_rate_limit_respeta_retry_after` — tras el 1.er intento `next_attempt_at == clock.now + 2s`.
  - `test_timeout_primer_intento_sin_http_status` — `attempt_log[0].http_status is None`.
  - `test_rejected_reprocesado_se_entrega` — llega a `dead`; `POST /api/events/{id}/replay` con `AUTH` ⇒ 200; nuevas pasadas ⇒ `delivered`, `len(attempt_log) == 2`, `mock.applied_count(id) == 1`.
  - `test_repos_no_demo_siguen_aleatorios` — `MockDownstream(failure_rate=1.0)` con repo `yo/r` ⇒ 503.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** implementar. **Step 4:** `pytest --cov=app -q` ⇒ verde; anotar cobertura real en el resumen.
- [ ] **Step 5: Commit** `feat(mock): respuestas deterministas por escenario de demo`.

### Task 5: Panel estático, arranque de la demo, Docker y Render

**Files:**
- Modify: `backend/app/api.py` (montar estáticos), `backend/app/main.py` (validación de arranque)
- Create: `backend/scripts/start_demo.sh`, `Dockerfile`, `.dockerignore`, `render.yaml`
- Create: `backend/tests/test_demo_app.py`

**Interfaces:**
- `create_app`: al final, si `settings.demo_mode and settings.static_dir and os.path.isdir(settings.static_dir)` ⇒ `app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="panel")` **después** de `include_router`.
- `main.py`: si `settings.demo_mode` y falta `webhook_secret` o `admin_token` ⇒ `raise SystemExit("DEMO_MODE exige WEBHOOK_SECRET y ADMIN_TOKEN")`. Extraer a `check_demo_settings(settings: Settings) -> None` en `config.py` para poder probarlo.
- `start_demo.sh` (bash, `set -euo pipefail`): `uvicorn mock_downstream.main:app --host 127.0.0.1 --port 9000 &`, `python -m app.worker &`, `uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --log-level warning &`, `wait -n; exit 1`. Sin `--proxy-headers` (la IP la resuelve `client_ip`).
- `Dockerfile`: etapa `node:22-slim` → `npm ci && npm run build` en `frontend`; etapa `python:3.12-slim` → `pip install --no-cache-dir -r backend/requirements.txt`, copia `backend/` a `/app` y `frontend/dist` a `/app/static`; `ENV` con los valores de demo de Global Constraints + `DEMO_MODE=true STATIC_DIR=/app/static DOWNSTREAM_URL=http://127.0.0.1:9000/ingest`; usuario no root; `CMD ["bash","scripts/start_demo.sh"]`. Sin secretos en la imagen.
- `render.yaml`: un `web` service `runtime: docker`, `plan: free`, `healthCheckPath: /health`, `envVars` `WEBHOOK_SECRET` y `ADMIN_TOKEN` con `sync: false`.

- [ ] **Step 1: Pruebas** en `test_demo_app.py` (con `tmp_path` que contiene `index.html` = `<h1>panel</h1>`):
  - `test_panel_servido_en_raiz` — `GET /` ⇒ 200 y contiene `panel`.
  - `test_estaticos_no_tapan_api` — `GET /api/events` JSON 200, `GET /health` `{"status":"ok"}`, `GET /docs` 200, `POST /webhooks/github` firmado ⇒ 202.
  - `test_sin_static_dir_no_monta` — `GET /` ⇒ 404.
  - `test_demo_sin_secretos_no_arranca` — `check_demo_settings(Settings(demo_mode=True))` lanza `SystemExit`; con ambos valores no lanza.
- [ ] **Step 2:** ⇒ FAIL. **Step 3:** implementar código + archivos de despliegue.
- [ ] **Step 4:** `pytest -q` ⇒ verde. Si hay Docker local: `docker build -t integrador-demo .` y `docker run --rm -p 8080:8080 -e WEBHOOK_SECRET=x -e ADMIN_TOKEN=y integrador-demo`; `curl localhost:8080/health` ⇒ `{"status":"ok"}`. Si no hay Docker, se verifica en el job `e2e` de Task 7 (decirlo en el resumen).
- [ ] **Step 5: Commit** `feat(deploy): imagen única de demo y blueprint de Render`.

### Task 6: Panel — token admin, simulador y detalle en vivo

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/App.tsx`, `frontend/src/pages/EventDetail.tsx`, `frontend/src/pages/DeadLetters.tsx`, `frontend/src/pages/shared.tsx`, `frontend/src/styles.css`, `frontend/vite.config.ts`
- Create: `frontend/src/pages/Simulate.tsx`, `frontend/src/TokenField.tsx`

**Interfaces:**
- `api.ts`: `getToken(): string` / `setToken(t: string): void` sobre `sessionStorage` clave `"adminToken"` (nunca `localStorage`); `request` añade `Authorization: Bearer <t>` si hay token. Nuevos: `api.demo(): Promise<{ demo: boolean }>`, `api.simulate(scenario: Scenario): Promise<{ id: string; status: Status }>`.
- `types.ts`: `type Scenario = "ok" | "recover" | "rate_limit" | "timeout" | "rejected"`.
- `TokenField`: `<label>Token admin</label>` + `input type="password"` + botón «Guardar»/«Salir»; muestra «Admin» o «Visitante».
- `Simulate`: un botón por escenario con texto exacto: «Éxito a la primera», «Falla 2 veces y se recupera», «429 con Retry-After», «Timeout y reintento», «Rechazado (4xx) → fallidos», cada uno con una línea que explica qué demuestra; al pulsar navega a `#/events/<id>`; errores 429 mostrados con `role="alert"`.
- `App`: si `api.demo()` dice `demo: true`, nav `["simulate","Simular"]` primero y es la ruta por defecto.
- `EventDetail`: refresco cada 1000 ms mientras `status` no sea `delivered`/`dead`; después deja de sondear.
- `DeadLetters`: sin token, el botón de reproceso queda `disabled` con texto «Requiere admin»; con token, igual que hoy; un 401 se muestra como error.
- `ErrorNote`: quitar la pista «puerto 8000» cuando el error es 401 (mostrar «Necesitas el token admin»).
- `vite.config.ts`: el proxy de dev también reenvía `/health`.

- [ ] **Step 1:** implementar (sin framework de pruebas unitarias en el panel; lo cubre Playwright en Task 7).
- [ ] **Step 2:** `cd frontend && npm run build` ⇒ sin errores de tipos.
- [ ] **Step 3:** prueba manual local con `DEMO_MODE=true` (API, worker, mock, `npm run dev`): simular `recover` y ver 3 intentos en vivo; reproceso deshabilitado sin token y funcional con token. Anotar resultado real.
- [ ] **Step 4: Commit** `feat(panel): simulador, token admin y detalle en vivo`.

### Task 7: E2E (pytest + Playwright) y job de CI

**Files:**
- Create: `backend/tests_e2e/__init__.py`, `backend/tests_e2e/conftest.py`, `backend/tests_e2e/test_demo_e2e.py`
- Create: `frontend/playwright.config.ts`, `frontend/e2e/demo.spec.ts`
- Modify: `frontend/package.json` (devDependency `@playwright/test`, script `"e2e": "playwright test"`), `frontend/tsconfig*.json` si `e2e/` rompe `tsc --noEmit` del build, `frontend/.gitignore` (informes de Playwright)
- Modify: `.github/workflows/ci.yml` (job `e2e`)

**Interfaces:**
- `tests_e2e/conftest.py`: `BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8080")`, `ADMIN_TOKEN`, `WEBHOOK_SECRET` del entorno; `wait_final(client, event_id, timeout=60) -> dict` — sondea `GET /api/events/{id}` cada 0.5 s hasta `delivered`/`dead`; falla con el último estado si vence. Comentario: tiempo real permitido solo en esta carpeta (no está en `testpaths`).
- Playwright: `baseURL` = `E2E_BASE_URL` con el mismo defecto; solo Chromium; `retries: 0`; selectores por rol/etiqueta.

- [ ] **Step 1: `test_demo_e2e.py`:**
  - parametrizada `test_escenario_extremo_a_extremo` con la misma tabla que Task 4 (estado y nº de intentos).
  - `test_webhook_firmado_y_duplicado` — POST real firmado con `WEBHOOK_SECRET` ⇒ 202; mismo `X-GitHub-Delivery` ⇒ 200 y `total` sin cambio.
  - `test_replay_sin_token_401_y_con_token_entrega` — `rejected` ⇒ `dead`; replay anónimo 401; con token 200 y `wait_final` ⇒ `delivered`.
- [ ] **Step 2: `demo.spec.ts`:**
  - «simular recuperación muestra 3 intentos y Entregado»: abrir `/`, pulsar «Falla 2 veces y se recupera», esperar badge «Entregado» (timeout 60 s) y 3 elementos en la lista de intentos.
  - «reproceso requiere admin»: simular «Rechazado», esperar «Fallido», ir a Fallidos ⇒ botón «Requiere admin» deshabilitado; rellenar «Token admin» con `process.env.ADMIN_TOKEN`, guardar, reprocesar ⇒ el evento acaba «Entregado».
- [ ] **Step 3: job `e2e`** en `ci.yml` (`needs: backend`): checkout; `docker build -t integrador-demo .`; `docker run -d --name demo -p 8080:8080 -e WEBHOOK_SECRET=e2e-secret -e ADMIN_TOKEN=e2e-admin -e DEMO_RATE_PER_MINUTE=1000 integrador-demo`; esperar `/health` (30 intentos de 1 s); setup-python 3.12 + `pip install -r backend/requirements.txt` + `pytest backend/tests_e2e -v` con esos `env`; setup-node 22 + `npm ci` + `npx playwright install --with-deps chromium` + `npm run e2e` en `frontend` con `ADMIN_TOKEN=e2e-admin`; si falla: `docker logs demo` y `actions/upload-artifact` con `frontend/playwright-report`.
- [ ] **Step 4:** ejecutar en local contra el contenedor si hay Docker; si no, push a una rama y comprobar el job `e2e` en GitHub Actions. Registrar el resultado real (enlace al run).
- [ ] **Step 5: Commit** `test(e2e): ciclo completo contra la imagen de demo en CI`.

### Task 8: Documentación con resultados comprobados

**Files:**
- Modify: `README.md`, `docs/test-plan.md`, `docs/risks.md`, `docs/runbook.md`, `docs/load-results.md`

- [ ] **Step 1: README:** sección «Demo en vivo» (enlace solo cuando exista; qué probar; se reinicia al dormirse; primer acceso ~1 min); uso local con `ADMIN_TOKEN`; modelo de roles; quitar «sin autenticación» de limitaciones; cifras de pruebas/cobertura **solo** de la última ejecución real.
- [ ] **Step 2: `test-plan.md`:** matriz endpoint × escenario × esperado × observado × evidencia (enlace a run de CI) × resultado, con capas unitarias (reloj virtual) / contrato / E2E (tiempo real) separadas.
- [ ] **Step 3: `risks.md`:** reemplazar fila «panel sin auth»; añadir abuso del simulador, token admin filtrado (rotar en Render), disco efímero. **`runbook.md`:** desplegar en Render y rotar `ADMIN_TOKEN`. **`load-results.md`:** una línea aclarando que sus cifras usan reloj virtual.
- [ ] **Step 4:** `pytest -q`, `export_openapi.py --check`, `npm run build` ⇒ verdes.
- [ ] **Step 5: Commit** `docs: demo pública, roles y matriz QA`.

### Despliegue (fuera del plan automático)

Requiere autorización explícita del usuario y su cuenta de Render: crear el Blueprint desde el repo, definir `WEBHOOK_SECRET` y `ADMIN_TOKEN` como secretos, comprobar `/health`, simular un escenario y actualizar el enlace del README.

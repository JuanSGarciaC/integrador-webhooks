# Diseño: demo pública segura del integrador de webhooks

Fecha: 2026-11-01 · Estado: borrador para aprobación

## Intención

Que un reclutador (perfil API Tester / Integration QA) abra un enlace y, sin instalar ni configurar nada, **vea el integrador funcionar**: lanza un escenario, mira el evento pasar por `received → processing → retrying → delivered/dead` con su historial de intentos, y comprueba que las acciones administrativas están protegidas. Todo respaldado por pruebas E2E automatizadas en CI contra la misma imagen que se despliega.

Cierra los dos P0 de la guía de portafolio (sección 3): autenticación antes de exponer y E2E del ciclo completo; y el P2 (separar pruebas con reloj virtual de las que usan tiempo real).

Referencias tomadas: Hookdeck Console / Svix Play (simular webhooks de ejemplo sin configurar nada, reintentar desde la vista de eventos); demos públicas con modo solo lectura aplicado **en el servidor**, denegar por defecto y datos de demo reiniciables.

## Objetivos

1. **Simulador de escenarios** en el panel y en la API.
2. **Autenticación y autorización en el servidor** para `/api/*`.
3. **Imagen Docker única** (API + worker + destino simulado + panel) desplegable en Render free.
4. **Pruebas E2E** (pytest contra procesos reales + Playwright sobre el panel) en CI contra esa imagen.
5. **Documentación honesta**: README (sección demo), `docs/test-plan.md` con matriz QA, `docs/risks.md`, `openapi.json`, colección Newman.

## No objetivos

- Conectar GitHub real a la demo (ya documentado en `docs/prueba-real-github.md`).
- PostgreSQL, varios workers, persistencia entre reinicios.
- Usuarios, contraseñas, OAuth, sesiones de servidor.
- Dominio propio o cualquier servicio de pago.

## Anti-objetivos (fracaso aunque funcione)

- Publicar el token de admin o cualquier secreto (en repo, README, logs o bundle del panel).
- Que un visitante pueda reprocesar, borrar o leer algo que no sea dato ficticio de la demo.
- Que la seguridad dependa de ocultar botones en el panel.
- Afirmar cifras (cobertura, tiempos, uptime) no medidas en esta implementación.
- Romper el uso local actual sin documentar el cambio (ahora exige token).

## Restricciones

- Coste cero; sin tarjeta. Render free: se duerme tras 15 min sin tráfico (~1 min en despertar), disco efímero, 750 h/mes, sin background workers gratis → todo en **un** servicio web.
- `AGENTS.md`: TDD, sin `sleep` ni hora real en pruebas unitarias (reloj inyectado), sin secretos en código, sin datos reales de personas, explicar cada cambio.
- Dependencias nuevas aprobadas por el usuario: **Playwright** (dev, panel) y **Dockerfile**. Ninguna otra en el backend (sin librerías de rate limit ni auth).
- Mantener la arquitectura actual: `create_app(settings, session_factory, clock)`, `repository`, `worker.process_once`, `MockDownstream`.

## Diseño

### 1. Configuración (`app/config.py`, `.env.example`)

| Variable | Defecto | Uso |
|---|---|---|
| `ADMIN_TOKEN` | `""` | Token Bearer del rol admin. Vacío ⇒ ninguna petición es admin (falla cerrado). |
| `DEMO_MODE` | `false` | Activa lectura anónima, simulador y servido estático del panel. |
| `DEMO_RATE_PER_MINUTE` | `10` | Simulaciones por IP y minuto. |
| `DEMO_MAX_EVENTS` | `500` | Tope de eventos guardados; al llegar, el simulador responde `429`. |

### 2. Autorización (`app/api.py`)

Matriz (aplicada como dependencia FastAPI en el router, no en el panel):

| Endpoint | Sin token, `DEMO_MODE=false` | Sin token, `DEMO_MODE=true` | Token admin válido |
|---|---|---|---|
| `GET /health` | 200 | 200 | 200 |
| `POST /webhooks/github` | firma HMAC (sin cambios) | firma HMAC | firma HMAC |
| `GET /api/events`, `/api/events/{id}`, `/api/stats` | **401** | 200 | 200 |
| `POST /api/events/{id}/replay` | **401** | **401** | 200/404/409 |
| `POST /api/demo/simulate` | **404** (no existe) | 200/422/429 | igual que anónimo |

- Cabecera `Authorization: Bearer <token>`; comparación con `hmac.compare_digest`; respuesta `401` con `WWW-Authenticate: Bearer` y `{"detail": ...}` (mismo formato que el resto).
- Token presente pero incorrecto ⇒ `401` también en modo demo (no se degrada a anónimo).

### 3. Simulador (`POST /api/demo/simulate`, solo con `DEMO_MODE`)

Cuerpo `{"scenario": "<nombre>"}`; respuesta `202 {"id", "status"}` como el webhook.

| Escenario | Comportamiento del destino simulado | Estado final esperado |
|---|---|---|
| `ok` | 200 al primer intento | `delivered`, 1 intento |
| `recover` | 503, 503, luego 200 | `delivered`, 3 intentos |
| `rate_limit` | 429 con `Retry-After: 2`, luego 200 | `delivered`, 2 intentos, espera ≥ 2 s |
| `timeout` | responde más lento que `HTTP_TIMEOUT_SECONDS` una vez, luego 200 | `delivered`, 2 intentos (primero sin `http_status`) |
| `rejected` | 422 en el **primer** intento de esa `Idempotency-Key`; después 200 (simula «se corrigió el destino») | `dead`, 1 intento; tras reproceso admin ⇒ `delivered`, 1 intento nuevo en el historial |

- El servidor construye un payload `push` **ficticio** (`repository.full_name = "demo/<escenario>"`, `sender.login = "visitante-demo"`), `X-GitHub-Delivery` = UUID nuevo, lo **firma con `WEBHOOK_SECRET`** y lo pasa por la **misma función de ingesta** que `POST /webhooks/github` (extraer el cuerpo del handler a una función compartida; el handler HTTP queda igual).
- `MockDownstream` gana un modo por escenario: lee `repository` del cuerpo normalizado (ya viaja: ver `mapping.normalize`), cuenta intentos por `Idempotency-Key` y responde según la tabla. Repositorios que no empiezan por `demo/` siguen la lógica aleatoria actual (sin cambios para `simulate_load.py` ni pruebas existentes).
- Límite por IP: ventana fija en memoria por minuto, con el reloj inyectado. `shortcut:` en memoria y por proceso, válido con un solo contenedor. IP del cliente: solo se confía en la cabecera configurada en `CLIENT_IP_HEADER` (en Render, `True-Client-IP`, que fija Cloudflare y el cliente no puede falsear); sin configurar, `request.client.host`. **Nunca** `X-Forwarded-For`: Render añade al valor que envía el cliente y el último valor es la IP de Cloudflare, no la del visitante (corregido al implementar, 2026-11-01). Prueba unitaria: un `X-Forwarded-For` falseado no esquiva el límite.
- Tope global: si `count(events) >= DEMO_MAX_EVENTS`, antes de insertar se **borran los eventos más antiguos en estado final** (`delivered`/`dead`, con sus intentos) hasta dejar hueco; si no hay ninguno en estado final ⇒ `429 "demo llena, prueba en un minuto"`. Así la demo nunca queda bloqueada por alguien que la llena. Función nueva en `repository` con su prueba.
- Escenario desconocido ⇒ `422` (validación Pydantic con `Literal`).

### 4. Panel (`frontend/`)

- Página nueva **«Simular»** (`#/simulate`, primera en el menú cuando la demo está activa): un botón por escenario con una línea que explica qué demuestra; tras pulsar, navega al detalle del evento.
- El detalle del evento **se refresca solo** (polling cada 1 s mientras el estado no sea `delivered`/`dead`), para ver los reintentos en vivo.
- Campo **«Token admin»** en la cabecera: se guarda en `sessionStorage` (nunca `localStorage`), se envía como `Authorization: Bearer` en todas las llamadas de `api.ts`. Sin token, el botón de reproceso muestra «Requiere admin» y, si se fuerza, el `401` del servidor se muestra como error.
- Cómo sabe el panel que hay demo: `GET /api/demo` (o campo en `/health`) devuelve `{"demo": true}`. Decisión del implementador; debe ser público.

### 5. Imagen y despliegue

- `Dockerfile` multi-etapa en la raíz: etapa Node construye el panel; etapa Python instala `backend/requirements.txt`, copia el backend y el `dist/` del panel.
- En `DEMO_MODE`, FastAPI sirve el panel estático en `/` (montado **después** de los routers para no tapar `/api`, `/webhooks`, `/docs`).
- Script de arranque: destino simulado en `127.0.0.1:9000`, worker, y `uvicorn` en `0.0.0.0:$PORT`. Si cualquiera de los tres muere, el contenedor termina (Render lo reinicia).
- Valores de demo en la imagen: `RETRY_BASE_SECONDS=1`, `RETRY_CAP_SECONDS=10`, `MAX_ATTEMPTS=4`, `POLL_INTERVAL_SECONDS=0.5`, `HTTP_TIMEOUT_SECONDS=2`, `DATABASE_URL=sqlite:////tmp/webhooks.db`. `WEBHOOK_SECRET` y `ADMIN_TOKEN` **solo** como variables secretas de Render; si faltan en `DEMO_MODE`, el arranque falla con mensaje claro.
- `render.yaml` (blueprint) con `envVars` marcados `sync: false` para los secretos.
- El despliegue real lo hace el usuario o se hace con su autorización explícita; la cuenta de Render la crea el usuario.

### 6. Pruebas

| Capa | Dónde | Reloj | En CI |
|---|---|---|---|
| Unitarias/integración (existentes + nuevas) | `backend/tests/` | virtual (`FakeClock`) | job `backend` |
| Contrato | Newman, `docs/postman/` | real | job `contract` |
| E2E API | `backend/tests_e2e/` (pytest, `BASE_URL`) | **real**, sondeo con plazo máximo | job `e2e` |
| E2E panel | `frontend/e2e/` (Playwright, Chromium) | real | job `e2e` |

Notas para pruebas: en unitarias el escenario `timeout` hace que el mock lance `httpx.TimeoutException` (sin `sleep`); en el contenedor responde lento de verdad. El job `e2e` sube `DEMO_RATE_PER_MINUTE` para no chocar con el límite. `scripts/export_openapi.py` debe generar el contrato con `DEMO_MODE=true` para que `/api/demo/simulate` figure en `openapi.json` (indicando que solo existe en demo).

Nuevas unitarias (TDD): matriz de autorización completa (tabla §2), simulador (cada escenario llega al estado final con `FakeClock` + `MockDownstream` vía `httpx.MockTransport`), límite por IP, tope global, mock por escenario, modo no demo ⇒ `/api/demo/simulate` 404. Las existentes se adaptan enviando el token admin desde el fixture `client`.

E2E API (contra el contenedor): los 5 escenarios llegan a su estado final con el número de intentos esperado; duplicado de `X-GitHub-Delivery` ⇒ `200` sin registro nuevo; replay sin token ⇒ `401`; replay con token de un `rejected` ⇒ vuelve a reintentarse; `/api/*` sin token con `DEMO_MODE=false` ⇒ `401` (segundo contenedor o arranque local).

E2E panel: simular `recover` y ver 3 intentos y `delivered`; en un `rejected`, el reproceso sin token no está disponible; con token admin, reprocesar lo lleva a `delivered`.

Job `e2e` de CI: `docker build`, `docker run` con secretos de prueba, esperar `/health`, ejecutar pytest E2E y Playwright, subir el informe de Playwright como artefacto si falla.

Newman: añadir cabecera de token por variable de colección y casos `401` (sin token, token incorrecto).

### 7. Documentación

- README: sección «Demo en vivo» (enlace, qué probar, que se reinicia al dormirse, primer acceso tarda ~1 min), cambio de uso local (`ADMIN_TOKEN` en `.env`), quitar «sin autenticación» de las limitaciones y explicar el modelo de roles.
- `docs/test-plan.md`: matriz endpoint × escenario × esperado × observado × evidencia (enlace a run de CI) × resultado. Solo resultados realmente ejecutados.
- `docs/risks.md`: actualizar la fila del panel sin auth; añadir abuso del simulador (límite por IP + tope), token admin filtrado (rotar en Render), disco efímero.
- `docs/openapi.json` regenerado (`scripts/export_openapi.py`).

## Decisiones tomadas por Claude (revisables)

- Un solo rol privilegiado (admin) y el visitante anónimo solo en demo; sin rol «viewer» con token.
- Escenario elegido por `repository.full_name` del payload ficticio, para no tocar el contrato con el destino.
- Límite por IP en memoria (sin dependencia nueva).
- Render free como destino; SQLite efímera como «reset» automático.
- Polling de 1 s en el detalle en lugar de WebSockets/SSE.
- `rejected` se acepta tras el reproceso: cuenta la historia completa de la cola de fallidos (falla → se corrige → admin reprocesa → entregado).
- Al llegar al tope se purgan los eventos finales más antiguos en vez de bloquear la demo.
- IP del cliente = cabecera fiable configurada (`CLIENT_IP_HEADER=True-Client-IP` en Render).

## A cargo del implementador

Nombres internos de funciones, forma exacta de exponer `{"demo": true}`, estilos del panel siguiendo `styles.css`, estructura del script de arranque, selectores de Playwright (preferir roles/etiquetas accesibles).

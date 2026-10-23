# Prueba real con GitHub (repo de pruebas + túnel temporal)

Requisitos: `gh` con sesión iniciada y `cloudflared`. Revisa las condiciones vigentes del servicio de túnel que uses.
Usa **solo un repositorio de pruebas propio**; nunca repositorios de empresas o terceros.

## 1. Repositorio de pruebas y secreto
```powershell
gh repo create webhooks-sandbox --private --add-readme
# secreto aleatorio -> backend/.env (no se sube a git)
python -c "import secrets;print(secrets.token_hex(32))"
```
Pon ese valor en `WEBHOOK_SECRET` de `backend/.env` y **reinicia API y worker** (leen el `.env` al arrancar).

## 2. Levantar todo
```powershell
cd backend
.venv\Scripts\python -m uvicorn mock_downstream.main:app --port 9000   # destino simulado
.venv\Scripts\python -m uvicorn app.main:app --port 8000               # API
.venv\Scripts\python -m app.worker                                     # worker
.venv\Scripts\python -m app.gateway                                    # pasarela :8001 (solo POST /webhooks/github)
```

## 3. Túnel hacia la pasarela (no hacia la API)
```powershell
cloudflared tunnel --url http://127.0.0.1:8001
```
Copia la URL `https://….trycloudflare.com`. Comprueba desde fuera: `/api/stats` → `404`; `POST /webhooks/github` sin firma → `401`.
La pasarela existe porque la API de consulta y el reproceso no tienen autenticación: el túnel nunca debe apuntar al puerto 8000.

## 4. Crear el webhook en el repo de pruebas
En GitHub: *Settings → Webhooks → Add webhook*: Payload URL = `<URL>/webhooks/github`, Content type = `application/json`, Secret = el de `.env`, eventos: `push`, `issues`, `pull_request`. GitHub envía un `ping` al crearlo.

## 5. Generar eventos y verificar
Crea un issue, haz un commit y abre un pull request en el repo de pruebas. Mira el panel (`http://127.0.0.1:5173`) y *Settings → Webhooks → Recent Deliveries*.
Prueba de duplicado: en *Recent Deliveries* pulsa **Redeliver** → la API responde `200` y no aparece un evento nuevo.

## 6. Limpieza (al terminar)
1. Cierra el túnel (Ctrl+C o detén el proceso `cloudflared`).
2. Borra el webhook: *Settings → Webhooks → Delete*.
3. Opcional: borra el repo de pruebas y rota/elimina el secreto del `.env`.

## Resultado de la ejecución del 2026-10-23
- Entregas de GitHub recibidas: `ping`, `issues`, 3 × `push` y `pull_request`; **las 6 respondieron `202`** y quedaron en la base.
- **Redeliver** del evento `issues`: la API respondió **`200`** y el total de eventos no cambió (18 antes y después).
- El worker entregó los eventos al destino simulado (que falla a propósito), con reintentos visibles en el panel.
- Destino siempre simulado; no se probó rendimiento ni volumen.

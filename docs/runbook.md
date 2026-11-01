# Runbook

Primera revisión siempre: panel → **Estadísticas** (conteos por estado) y `GET /api/stats`.

## Crece la cola de fallidos (`dead`)
1. Panel → **Fallidos**; abre un evento y mira el historial de intentos.
2. Si el error es `HTTP 4xx` (400/401/403/404/422): es de **configuración o contrato** (URL del destino, credenciales, formato). Reintentar no lo arregla. Corrige y luego **Reprocesar**.
3. Si son `HTTP 5xx`/`ConnectTimeout` que agotaron los 6 intentos: el destino estuvo caído. Cuando se recupere, **Reprocesar** (reinicia los intentos). El destino debe ser idempotente (misma `Idempotency-Key`).
4. Reprocesa de a pocos si son muchos, para no saturar al destino recién recuperado.

## El worker no avanza (muchos `received`/`retrying` vencidos)
1. ¿Está corriendo `python -m app.worker`? Los logs son JSON, una línea por intento.
2. Eventos en `processing` tras una caída: se retoman solos cuando vence `locked_until` (60 s por defecto). Puede entregarse dos veces el que se estaba procesando: es la semántica *al menos una vez*.
3. Error `database is locked`: hay transacciones largas; SQLite está en modo WAL con `busy_timeout`. Verifica que haya un solo worker.

## El destino está caído
Los eventos pasan a `retrying` con espera creciente (tope 5 min). No hace falta acción: se entregan al recuperarse. Si pasan de 6 intentos terminan en `dead` (ver arriba).

## Webhooks rechazados (`401`)
Revisa que `WEBHOOK_SECRET` coincida con el secreto del webhook en GitHub y que no haya un proxy que altere el cuerpo (la firma es sobre el cuerpo crudo).

## Demo pública (Render)
1. **Desplegar:** en Render, *New → Blueprint* sobre este repositorio (usa `render.yaml`). Render genera `WEBHOOK_SECRET` y `ADMIN_TOKEN`. El token admin se consulta en *Environment* del servicio.
2. **Comprobar:** `GET /health` responde `{"status":"ok"}`; en el panel, «Simular → Falla 2 veces y se recupera» llega a Entregado con 3 intentos.
3. **Rotar el token admin** (si se filtró): *Environment → ADMIN_TOKEN → Generate* y redeploy. Los paneles abiertos pierden el rol admin al recargar.
4. **«demo llena» (`429`):** todos los eventos guardados siguen en curso. Se libera sola cuando terminan o cuando el servicio se duerme.
5. **El contenedor se reinicia en bucle:** revisa los logs; si dice `DEMO_MODE exige WEBHOOK_SECRET y ADMIN_TOKEN`, faltan esas variables.
6. **Tras el primer despliegue, verificar el límite por IP** (pendiente: no se puede comprobar sin la demo en marcha): enviar 11 simulaciones con `-H "True-Client-IP: <IP aleatoria distinta cada vez>"`. Si la 11.ª no da `429`, Render deja pasar la cabecera del cliente: cambiar `CLIENT_IP_HEADER` a `CF-Connecting-IP` y repetir. Anotar el resultado en `docs/test-plan.md`.

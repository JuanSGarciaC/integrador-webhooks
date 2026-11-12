# Lienzo del recorrido y conexión con triaje-solicitudes

Fecha: 2026-11-11. Aprobado por el autor antes de construir.

## Objetivo

1. Que el panel muestre el recorrido de un evento como un lienzo vivo, con solo tema oscuro.
2. Que un issue de GitHub pueda llegar a [triaje-solicitudes](https://github.com/JuanSGarciaC/triaje-solicitudes) pasando por el integrador, sin fusionar los repositorios y sin cambiar el comportamiento por defecto.

## Parte visual

- **Lienzo** (`frontend/src/Flow.tsx`), un solo componente con dos usos:
  - *Detalle de un evento*: Webhook → API → Cola → Worker → Destino, con rama a Fallidos y arco de vuelta Worker → Cola. Un punto recorre el tramo que corresponde a cada cambio de estado. El Worker gira solo mientras hay un intento en curso; en `retrying` la Cola muestra la cuenta atrás hasta `next_attempt_at`.
  - *Simular*: reemplaza la lista estática; cada nodo muestra su conteo de `GET /api/stats` y las aristas fluyen solo por donde pasaron eventos.
- **Tema**: solo oscuro. Se elimina el claro.
- **Tarjetas**: brillo que sigue al puntero; todo el movimiento se apaga con `prefers-reduced-motion`.
- **«Enviado al destino»**: `GET /api/events/{id}` añade `outbound`, el JSON que el worker envía, calculado con la misma función. Se recalcula al consultar; no se guarda por intento.
- El estado sigue comunicándose con icono y texto, no solo con color.

## Conexión con triaje

Contrato: el integrador se adapta al destino (es su trabajo); triaje solo añade idempotencia.

| Lado | Cambio |
|---|---|
| triaje | `POST /api/requests` respeta `Idempotency-Key`: misma clave → solicitud original con `200`, sin volver a clasificar |
| integrador | `DOWNSTREAM_FORMAT=triaje` (por defecto, vacío: formato resumido actual) |

Con `DOWNSTREAM_FORMAT=triaje`:

- El worker envía `{"subject": título (máx. 200), "body": cuerpo del issue (máx. 4000; «(sin descripción)» si viene vacío), "requester": usuario}` con `Idempotency-Key` = id del evento.
- La entrada solo guarda `issues` con `action: opened`. El resto se responde `200` con `ignorado` y no se guarda: no hay estado nuevo en la base ni en el panel.
- El simulador de la demo ofrece un único escenario, `issue`, con un texto ficticio.
- `GET /api/demo` añade `destination` (`mock` o `triaje`) para que el panel rotule el nodo Destino.

`docker-compose.triaje.yml` levanta ambos servicios; triaje se construye desde su repositorio fijado a un commit y usa el clasificador de reglas (sin API de pago).

## Decisión que cambia

Hasta ahora el integrador no reenviaba contenido del payload, solo un resumen. En modo triaje envía título y cuerpo del issue porque es justo lo que el destino necesita clasificar. Sigue sin enviarse el payload completo. Queda registrado en `docs/architecture.md`.

## Fuera de alcance

- Conectar las dos demos públicas (la de triaje rechaza texto libre por diseño).
- Autenticación entre servicios: en el compose hablan por la red interna.
- Guardar en el integrador el id de la solicitud creada en triaje.
- Eventos `issues` editados o cerrados.

## Pruebas

- Unitarias: mapeo a triaje (recortes, cuerpo vacío), filtro de entrada, `outbound`, escenario `issue`.
- E2E del panel existente, adaptado al tema nuevo.
- E2E de la conexión, en un job de CI aparte: issue firmado → aparece en triaje; reenvío del mismo evento → una sola solicitud.

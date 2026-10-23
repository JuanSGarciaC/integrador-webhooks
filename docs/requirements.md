# Requisitos e historias de usuario

Formato: *Dado / Cuando / Entonces*. Cada criterio enlaza a su prueba en `test-plan.md`.

| ID | Historia | Criterio de aceptación |
|---|---|---|
| HU-01 | Como operador quiero rechazar webhooks no auténticos | **Dado** un webhook con firma inválida o ausente, **cuando** llega, **entonces** se responde `401` y no se guarda nada |
| HU-02 | Como operador quiero aceptar webhooks válidos rápido | **Dado** un webhook firmado de tipo `push`, `issues`, `pull_request` o `ping`, **cuando** llega, **entonces** se responde `202` y queda en estado `received` |
| HU-03 | Como operador quiero que los reenvíos no dupliquen trabajo | **Dado** un `delivery_id` ya recibido, **cuando** llega otra vez, **entonces** se responde `200` y no se crea un segundo registro |
| HU-04 | Como operador quiero proteger el servicio de cuerpos enormes | **Dado** un cuerpo mayor al límite, **cuando** llega, **entonces** se responde `413` sin guardarlo |
| HU-05 | Como integrador quiero entregar eventos normalizados | **Dado** un evento `received` vencido, **cuando** el worker lo procesa, **entonces** el destino recibe `event_id, source, type, repository, actor, summary, occurred_at` y la cabecera `Idempotency-Key` = id del evento |
| HU-06 | Como integrador quiero reintentar fallos transitorios | **Dado** un destino que responde `5xx`, `429` o agota el tiempo, **cuando** el worker intenta, **entonces** el evento pasa a `retrying` con espera exponencial con jitter (respetando `Retry-After` en `429`) |
| HU-07 | Como integrador no quiero reintentar errores permanentes | **Dado** una respuesta `4xx` (salvo `429`), **cuando** el worker intenta, **entonces** el evento pasa a `dead` de inmediato |
| HU-08 | Como operador quiero que nada se pierda en silencio | **Dado** que se agotan los intentos (6 por defecto), **cuando** falla el último, **entonces** el evento queda en `dead` con su último error |
| HU-09 | Como operador quiero recuperarme de una caída del worker | **Dado** un evento `processing` con `locked_until` vencido, **cuando** corre el siguiente ciclo, **entonces** otro ciclo lo retoma |
| HU-10 | Como operador quiero reprocesar fallidos | **Dado** un evento `dead`, **cuando** pido `replay`, **entonces** pasa a `retrying` con 0 intentos; **y** si no está `dead` se responde `409`, si no existe `404` |
| HU-11 | Como operador quiero ver qué pasó | **Dado** eventos en distintos estados, **cuando** consulto la API o el panel, **entonces** puedo filtrar por estado/tipo, ver el historial de intentos y las estadísticas |
| HU-12 | Como dueño del sistema quiero un contrato verificable | **Dado** un cambio de rutas, **cuando** corre CI, **entonces** falla si `openapi.json` no se regeneró y si Newman no pasa |

## Requisitos no funcionales
- Seguridad: secreto en `.env`; firma sobre cuerpo crudo y comparación en tiempo constante; límite de tamaño; timeout en llamadas salientes; logs sin secretos ni payload.
- Fiabilidad: entrega **al menos una vez** con consumidor idempotente. No se garantiza orden entre eventos.
- Pruebas deterministas: reloj y jitter inyectables, sin `sleep`.

# Diccionario de datos

Fechas: UTC sin zona (SQLite).

## `events`
| Campo | Tipo | Significado | Valores / reglas |
|---|---|---|---|
| `id` | texto(36) | UUID del evento; es la `Idempotency-Key` hacia el destino | PK |
| `source` | texto | origen | `github` |
| `delivery_id` | texto | valor de `X-GitHub-Delivery` | único junto con `source` |
| `event_type` | texto | valor de `X-GitHub-Event` | `push`, `issues`, `pull_request`, `ping` |
| `payload` | texto | cuerpo original JSON (sin transformar) | no se envía completo al destino |
| `status` | texto | estado del ciclo de vida | `received`, `processing`, `retrying`, `delivered`, `dead` |
| `attempts` | entero | intentos de entrega hechos | ≥ 0; se reinicia en `replay` |
| `next_attempt_at` | fecha | desde cuándo puede intentarse | se actualiza con la espera calculada |
| `locked_until` | fecha o nulo | bloqueo del worker; si vence, otro ciclo retoma el evento | nulo fuera de `processing` |
| `last_error` | texto o nulo | último error legible (`HTTP 503`, `ConnectTimeout: …`) | nulo al entregarse |
| `received_at` | fecha | cuándo llegó | |
| `delivered_at` | fecha o nulo | cuándo se entregó | `delivered_at − received_at` = tiempo de entrega |

## `delivery_attempts`
| Campo | Tipo | Significado |
|---|---|---|
| `id` | entero | PK autoincremental |
| `event_id` | texto | FK a `events.id` |
| `attempted_at` | fecha | momento del resultado |
| `http_status` | entero o nulo | nulo si hubo timeout o error de conexión |
| `duration_ms` | entero | duración de la llamada (reloj real) |
| `error` | texto o nulo | error legible |

## Formato normalizado hacia el destino
`event_id`, `source`, `type`, `repository`, `actor`, `summary`, `occurred_at` (si el evento no trae fecha propia, se usa `received_at`).

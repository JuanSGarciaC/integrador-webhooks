## Resultados de `simulate_load.py` (2026-10-23)

- Equipo: Windows-11-10.0.28120-SP0 · Python 3.12.10
- N = 200 eventos por escenario · semilla = 42 · destino SIMULADO (la mitad de los fallos son 'ack perdido': el destino aplica el efecto y responde 503)
- Reintentos: base 2.0s, factor 2.0, tope 300.0s, jitter completo, máx. 6 intentos
- Tiempos en reloj VIRTUAL (tiempo simulado según la política, no latencia medida)

| Fallos inyectados | Entregados / total | `dead` | Intentos prom. | p50 (s) | p95 (s) | Aplicados en destino | Reentregas absorbidas | Duplicados efectivos |
|---|---|---|---|---|---|---|---|---|
| 0% | 200 / 200 | 0 | 1.0 | 0.0 | 0.0 | 200 | 0 | 0 |
| 30% | 200 / 200 | 0 | 1.49 | 0.0 | 3.4 | 200 | 49 | 0 |
| 60% | 194 / 200 | 6 | 2.38 | 0.5 | 16.8 | 200 | 135 | 0 |

«Duplicados efectivos» es 0 por construcción del destino simulado idempotente; lo que demuestra la idempotencia es que «Reentregas absorbidas» > 0 sin duplicar el efecto.

# Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Añadir demasiado (Redis, Kafka, nube) | El alcance del diseño es el contrato; lo extra va a «mejoras futuras» |
| SQLite bloqueado con worker y API a la vez | Modo WAL, `busy_timeout`, transacciones cortas, un solo worker |
| Pruebas que dependen del tiempo real | Reloj y jitter inyectables; sin `sleep` |
| Código que no se puede explicar | Reglas de `AGENTS.md`; cada cambio se explica antes de aceptarlo |
| Exponer secretos o URLs de túnel | `.env` ignorado por git; lista de seguridad antes de cada commit |
| Resultados inflados | Solo cifras de `simulate_load.py`, con sus limitaciones declaradas (reloj virtual, destino simulado) |
| Entrega duplicada por caída entre entregar y registrar | Semántica al menos una vez + `Idempotency-Key`; el destino debe ser idempotente |
| Cualquiera con acceso al panel puede reprocesar | `/api/*` exige token Bearer de admin; el visitante de la demo solo lee y simula; la autorización se aplica en el servidor, no ocultando botones |
| Abuso del simulador de la demo | 10 simulaciones por minuto por IP (`True-Client-IP`, no `X-Forwarded-For`); tope de 500 eventos, purgando solo los terminados |
| Token admin filtrado | Lo genera Render y no está en el repo ni en el bundle; el panel lo guarda solo en `sessionStorage`. Si se filtra, regenerarlo en Render (ver runbook) |
| Datos de la demo perdidos al dormirse | Esperado: el disco es efímero y funciona como reinicio automático; los datos son ficticios |
| Demo expuesta sin secretos | El contenedor no arranca en `DEMO_MODE` sin `WEBHOOK_SECRET` y `ADMIN_TOKEN` |

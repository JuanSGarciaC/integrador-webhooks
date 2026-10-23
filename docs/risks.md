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
| Cualquiera con acceso al panel puede reprocesar | El panel y la API de consulta no tienen autenticación: solo ejecutar en local |

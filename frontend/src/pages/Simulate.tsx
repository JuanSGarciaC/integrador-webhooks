import { useState } from "react";
import { api } from "../api";
import type { Scenario } from "../types";
import { HttpCode } from "./shared";

// [escenario, botón, explicación, respuestas esperadas del destino (null = sin respuesta), estado final]
const SCENARIOS: [Scenario, string, string, (number | null)[], string][] = [
  ["ok", "Éxito a la primera", "El destino responde 200: un solo intento y el evento queda Entregado.", [200], "Entregado"],
  ["recover", "Falla 2 veces y se recupera", "Dos 503 seguidos: verás los reintentos con espera exponencial y jitter hasta el 200.", [503, 503, 200], "Entregado"],
  ["rate_limit", "429 con Retry-After", "El destino pide esperar 2 s: el worker respeta Retry-After en lugar de su propio backoff.", [429, 200], "Entregado"],
  ["timeout", "Timeout y reintento", "El destino no responde a tiempo: el intento queda sin código HTTP y se reintenta.", [null, 200], "Entregado"],
  ["rejected", "Rechazado (4xx) → fallidos", "Un 422 es un error permanente: va directo a Fallidos sin reintentar. Un admin puede reprocesarlo.", [422], "Fallido"],
];

const FLOW: [string, string][] = [
  ["Webhook firmado", "GitHub o este simulador"],
  ["API", "HMAC + idempotencia → 202"],
  ["Cola (SQLite)", "patrón outbox"],
  ["Worker", "backoff exponencial + jitter"],
  ["Destino", "Idempotency-Key"],
];

export function Simulate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(s: Scenario) {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.simulate(s);
      window.location.hash = `#/events/${id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="t">
      <h2 id="t">Simular un webhook</h2>
      <p className="lead">
        Cada botón crea un evento <code>push</code> ficticio, firmado con HMAC, que entra por el mismo
        camino que un webhook real de GitHub. El destino simulado se comporta según el escenario y
        podrás seguir cada intento en vivo.
      </p>
      <ol className="flow panel" aria-label="Recorrido de un evento">
        {FLOW.map(([title, detail]) => (
          <li key={title}><strong>{title}</strong><span>{detail}</span></li>
        ))}
      </ol>
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="scenarios">
        {SCENARIOS.map(([key, label, help, codes, final]) => (
          <li key={key} className="card">
            <button onClick={() => run(key)} disabled={busy} aria-describedby={`h-${key}`}>{label}</button>
            <p id={`h-${key}`}>{help}</p>
            <div className="expect">
              <span>Esperado:</span>
              {codes.map((c, i) => <HttpCode key={i} status={c} />)}
              <span>→ {final}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useState } from "react";
import { api } from "../api";
import type { Scenario } from "../types";

const SCENARIOS: [Scenario, string, string][] = [
  ["ok", "Éxito a la primera", "El destino responde 200: un solo intento y el evento queda Entregado."],
  ["recover", "Falla 2 veces y se recupera", "Dos 503 seguidos: verás los reintentos con espera exponencial y jitter hasta el 200."],
  ["rate_limit", "429 con Retry-After", "El destino pide esperar 2 s: el worker respeta Retry-After en lugar de su propio backoff."],
  ["timeout", "Timeout y reintento", "El destino no responde a tiempo: el intento queda sin código HTTP y se reintenta."],
  ["rejected", "Rechazado (4xx) → fallidos", "Un 422 es un error permanente: va directo a Fallidos sin reintentar. Un admin puede reprocesarlo."],
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
      <p>
        Cada botón crea un evento <code>push</code> ficticio, firmado con HMAC, que entra por el mismo
        camino que un webhook real de GitHub. El destino simulado se comporta según el escenario y
        podrás seguir cada intento en vivo.
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="scenarios">
        {SCENARIOS.map(([key, label, help]) => (
          <li key={key} className="card">
            <button onClick={() => run(key)} disabled={busy} aria-describedby={`h-${key}`}>{label}</button>
            <p id={`h-${key}`}>{help}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

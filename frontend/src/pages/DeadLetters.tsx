import { useState } from "react";
import { api } from "../api";
import { useToken } from "../TokenField";
import { ErrorNote, fmtDate, HttpCode, useFetch } from "./shared";

export function DeadLetters() {
  const { data, error, reload } = useFetch(() => api.events({ status: "dead", limit: 100 }), [], 3000);
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = useToken() !== "";

  async function replay(id: string) {
    if (!window.confirm("¿Devolver este evento a la cola para reprocesarlo?")) return;
    try {
      await api.replay(id);
      setMsg("Evento devuelto a la cola.");
    } catch (e) {
      setMsg((e as Error).message);
    }
    reload();
  }

  return (
    <section aria-labelledby="t">
      <h2 id="t">Eventos fallidos</h2>
      <p className="lead">Eventos que agotaron intentos o recibieron un error permanente (4xx). Revísalos según el runbook.</p>
      {!isAdmin && <p className="note">Reprocesar es una acción de administración: introduce el token admin arriba.</p>}
      <p role="status" className="note">{msg}</p>
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <p className="empty">No hay eventos fallidos. 🎉 Todo lo recibido se entregó o está en curso.</p>}
      {data && data.items.length > 0 && (
        <table>
          <thead><tr><th>Recibido</th><th>Tipo</th><th>Intentos</th><th>Último error</th><th>Acción</th></tr></thead>
          <tbody>
            {data.items.map((e) => (
              <tr key={e.id}>
                <td><a href={`#/events/${e.id}`}>{fmtDate(e.received_at)}</a></td>
                <td>{e.event_type}</td>
                <td>{e.attempts}</td>
                <td>{e.last_error?.startsWith("HTTP ") ? <HttpCode status={Number(e.last_error.slice(5))} /> : e.last_error ?? "—"}</td>
                <td>
                  <button className={isAdmin ? "primary" : ""} onClick={() => replay(e.id)} disabled={!isAdmin}>
                    {isAdmin ? "Reprocesar" : "Requiere admin"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

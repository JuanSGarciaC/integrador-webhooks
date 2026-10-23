import { useState } from "react";
import { api } from "../api";
import { ErrorNote, fmtDate, StatusBadge, useFetch } from "./shared";

const PAGE = 25;
const STATUSES = ["received", "processing", "retrying", "delivered", "dead"];
const TYPES = ["push", "issues", "pull_request", "ping"];

export function Events() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error } = useFetch(
    () => api.events({ status, event_type: type, limit: PAGE, offset }),
    [status, type, offset],
    3000,
  );

  return (
    <section aria-labelledby="t">
      <h2 id="t">Eventos</h2>
      <div className="filters">
        <label>Estado
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">Todos</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Tipo
          <select value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }}>
            <option value="">Todos</option>
            {TYPES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && (
        <p className="empty">
          Aún no hay eventos. Envía uno con <code>python scripts/send_webhook.py</code>.
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <table>
            <thead>
              <tr><th>Recibido</th><th>Tipo</th><th>Estado</th><th>Intentos</th><th>Último error</th></tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td><a href={`#/events/${e.id}`}>{fmtDate(e.received_at)}</a></td>
                  <td>{e.event_type}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.attempts}</td>
                  <td>{e.last_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</button>
            <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} de {data.total}</span>
            <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Siguiente</button>
          </div>
        </>
      )}
    </section>
  );
}

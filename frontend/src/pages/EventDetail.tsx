import { api } from "../api";
import { ErrorNote, fmtDate, StatusBadge, useFetch } from "./shared";

export function EventDetail({ id }: { id: string }) {
  const { data: ev, error } = useFetch(() => api.event(id), [id], 3000);
  if (error) return <><a href="#/events">← Volver</a><ErrorNote message={error} /></>;
  if (!ev) return <p>Cargando…</p>;
  return (
    <section aria-labelledby="t">
      <a href="#/events">← Volver</a>
      <h2 id="t">Evento <code>{ev.event_type}</code> <StatusBadge status={ev.status} /></h2>
      <dl>
        <dt>ID</dt><dd><code>{ev.id}</code></dd>
        <dt>Delivery ID</dt><dd><code>{ev.delivery_id}</code></dd>
        <dt>Recibido</dt><dd>{fmtDate(ev.received_at)}</dd>
        <dt>Entregado</dt><dd>{fmtDate(ev.delivered_at)}</dd>
        {ev.status === "retrying" && <><dt>Próximo intento</dt><dd>{fmtDate(ev.next_attempt_at)}</dd></>}
      </dl>
      <h3>Historial de intentos</h3>
      {ev.attempt_history.length === 0 ? (
        <p className="empty">Todavía no hay intentos de entrega.</p>
      ) : (
        <ol className="timeline">
          {ev.attempt_history.map((a, i) => (
            <li key={i}>
              <strong>#{i + 1}</strong> · {fmtDate(a.attempted_at)} ·{" "}
              {a.http_status === null ? "sin respuesta" : `HTTP ${a.http_status}`} · {a.duration_ms} ms
              {a.error && <div className="err-text">{a.error}</div>}
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary>Payload original</summary>
        <pre>{ev.payload}</pre>
      </details>
    </section>
  );
}

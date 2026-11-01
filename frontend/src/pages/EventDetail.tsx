import { useState } from "react";
import { api } from "../api";
import { ErrorNote, fmtDate, fmtSeconds, HttpCode, outcome, StatusBadge, useFetch } from "./shared";

const seconds = (a: string, b: string) => (new Date(b + "Z").getTime() - new Date(a + "Z").getTime()) / 1000;

export function EventDetail({ id }: { id: string }) {
  // En vivo (1 s) mientras el evento está en curso; al llegar a un estado final deja de sondear.
  const [live, setLive] = useState(true);
  const { data: ev, error } = useFetch(
    () => api.event(id).then((e) => { setLive(e.status !== "delivered" && e.status !== "dead"); return e; }),
    [id],
    live ? 1000 : 0,
  );
  if (error) return <><a className="back" href="#/events">← Volver</a><ErrorNote message={error} /></>;
  if (!ev) return <p>Cargando…</p>;
  const history = ev.attempt_history;
  return (
    <section aria-labelledby="t">
      <a className="back" href="#/events">← Volver a eventos</a>
      <div className="title-row">
        <h2 id="t">Evento <code>{ev.event_type}</code> <StatusBadge status={ev.status} /></h2>
        {live && <span className="pill live" role="status">En vivo</span>}
      </div>
      <dl className="facts">
        <div className="card"><dt>Delivery ID</dt><dd className="mono">{ev.delivery_id}</dd></div>
        <div className="card"><dt>Recibido</dt><dd>{fmtDate(ev.received_at)}</dd></div>
        {ev.status === "retrying"
          ? <div className="card"><dt>Próximo intento</dt><dd>{fmtDate(ev.next_attempt_at)}</dd></div>
          : <div className="card"><dt>Entregado</dt><dd>{fmtDate(ev.delivered_at)}</dd></div>}
        <div className="card">
          <dt>Tiempo total</dt>
          <dd>{ev.delivered_at ? fmtSeconds(seconds(ev.received_at, ev.delivered_at)) : "—"}</dd>
        </div>
      </dl>

      <h3>Historial de intentos ({history.length})</h3>
      {history.length === 0 ? (
        <p className="empty">Todavía no hay intentos de entrega.</p>
      ) : (
        <ol className="timeline">
          {history.map((a, i) => (
            <li key={i} className={outcome(a.http_status)}>
              <div className="attempt-head">
                <strong>Intento #{i + 1}</strong>
                <HttpCode status={a.http_status} />
                <span className="meta">{fmtDate(a.attempted_at)} · {a.duration_ms} ms</span>
              </div>
              {/* El error solo aporta si dice algo más que el código ya mostrado. */}
              {a.error && a.error !== `HTTP ${a.http_status}` && <div className="err-text">{a.error}</div>}
              {i > 0 && (
                <span className="wait">
                  Esperó {fmtSeconds(seconds(history[i - 1].attempted_at, a.attempted_at))} tras el intento anterior
                </span>
              )}
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

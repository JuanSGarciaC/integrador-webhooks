import { api } from "../api";
import { ErrorNote, StatusBadge, useFetch } from "./shared";
import type { Status } from "../types";

const sec = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} s`);

export function Stats() {
  const { data: s, error } = useFetch(api.stats, [], 5000);
  if (error) return <ErrorNote message={error} />;
  if (!s) return <p>Cargando…</p>;
  if (s.total === 0)
    return <p className="empty">Aún no hay datos. Crea eventos desde «Simular» (demo) o con <code>python scripts/send_webhook.py</code>.</p>;
  return (
    <section aria-labelledby="t">
      <h2 id="t">Estadísticas</h2>
      <p className="lead">Calculadas en el servidor sobre los eventos guardados (<code>GET /api/stats</code>).</p>
      <div className="cards">
        <div className="card"><span>Total</span><strong>{s.total}</strong></div>
        <div className="card"><span>Entregados</span><strong>{s.delivered_ratio === null ? "—" : `${(s.delivered_ratio * 100).toFixed(1)} %`}</strong></div>
        <div className="card"><span>Intentos promedio</span><strong>{s.avg_attempts ?? "—"}</strong></div>
        <div className="card"><span>Entrega p50</span><strong>{sec(s.delivery_seconds.p50)}</strong></div>
        <div className="card"><span>Entrega p95</span><strong>{sec(s.delivery_seconds.p95)}</strong></div>
      </div>
      <h3>Por estado</h3>
      <div className="bar" role="img"
           aria-label={(Object.keys(s.by_status) as Status[]).map((k) => `${k}: ${s.by_status[k]}`).join(", ")}>
        {(Object.keys(s.by_status) as Status[]).map((k) =>
          s.by_status[k] > 0 && <span key={k} className={`s-${k}`} style={{ width: `${(s.by_status[k] / s.total) * 100}%` }} />)}
      </div>
      <ul className="by-status">
        {(Object.keys(s.by_status) as Status[]).map((k) => (
          <li key={k}><StatusBadge status={k} /> <strong>{s.by_status[k]}</strong></li>
        ))}
      </ul>
      <p className="note">Tiempo de entrega = entregado − recibido, calculado sobre eventos entregados.</p>
    </section>
  );
}

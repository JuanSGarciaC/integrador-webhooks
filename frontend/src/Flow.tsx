import { useEffect, useRef, useState } from "react";
import { fmtSeconds } from "./pages/shared";
import type { EventDetailData, Stats, Status } from "./types";

const W = 1100;
const H = 320;

// Aristas en coordenadas del viewBox; los nodos HTML se colocan con las mismas coordenadas en %.
const EDGES = {
  in_api: "M165,105 L225,105",
  api_q: "M375,105 L445,105",
  q_w: "M595,105 L685,105",
  w_d: "M835,105 L925,105",
  w_f: "M835,128 C895,128 865,255 925,255",
  w_q: "M740,150 C740,245 540,245 540,150",
} as const;
type EdgeId = keyof typeof EDGES;
type NodeId = "in" | "api" | "q" | "w" | "d" | "f";

// Nodo al que llega cada arista y nodos que ya quedaron atrás cuando el punto la recorre.
const TARGET: Record<EdgeId, NodeId> = { in_api: "api", api_q: "q", q_w: "w", w_d: "d", w_f: "f", w_q: "q" };
const BEHIND: Record<EdgeId, NodeId[]> = {
  in_api: ["in"], api_q: ["in", "api"], q_w: ["in", "api", "q"],
  w_d: ["in", "api", "q", "w"], w_f: ["in", "api", "q", "w"], w_q: ["in", "api"],
};
const END: Partial<Record<Status, EdgeId>> = { delivered: "w_d", dead: "w_f", retrying: "w_q" };

const at = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** El simulador anota aquí el evento que acaba de crear: su lienzo arranca desde el webhook. */
export const justCreated = { id: "" };

interface Props {
  /** Detalle: el lienzo sigue a este evento. */
  event?: EventDetailData;
  /** Resumen: conteos de GET /api/stats. */
  stats?: Stats;
  destination: string;
}

export default function Flow({ event, stats, destination }: Props) {
  const paths = useRef<Partial<Record<EdgeId, SVGPathElement | null>>>({});
  const dot = useRef<SVGGElement>(null);
  const queue = useRef<EdgeId[]>([]);
  const raf = useRef(0);
  const seen = useRef("");
  // Arista que recorre el punto ahora mismo; null = quieto, el lienzo muestra el estado real.
  const [edge, setEdge] = useState<EdgeId | null>(null);
  const [now, setNow] = useState(Date.now);

  const status = event?.status;
  const attempts = event?.attempts ?? 0;

  useEffect(() => {
    if (!event) return;
    const key = `${status}:${attempts}`;
    const first = seen.current === "";
    if (seen.current === key) return;
    seen.current = key;
    const route: EdgeId[] = [];
    if (first) {
      if (justCreated.id !== event.id) return; // evento ya existente: se muestra tal como está
      route.push("in_api", "api_q");
    }
    if (status !== "received") {
      route.push("q_w");
      const end = status && END[status];
      if (end) route.push(end);
    } else if (!first) return; // reproceso: vuelve a la cola sin recorrido
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    queue.current.push(...route);
    if (raf.current) return; // ya hay un recorrido en marcha: este tramo espera su turno
    let t0 = performance.now();
    let current = queue.current.shift()!;
    setEdge(current);
    const tick = (t: number) => {
      const f = Math.max(0, t - t0) / 480; // la marca del primer frame puede ser anterior a t0
      const path = paths.current[current]!;
      const p = path.getPointAtLength(path.getTotalLength() * ease(Math.min(1, f)));
      dot.current?.setAttribute("transform", `translate(${p.x} ${p.y})`);
      if (f >= 1) {
        const next = queue.current.shift();
        if (!next) {
          raf.current = 0;
          return setEdge(null);
        }
        current = next;
        t0 = t;
        setEdge(next);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, status, attempts]);
  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    queue.current = [];
    seen.current = "";
  }, []);

  // Cuenta atrás hasta el siguiente intento: solo corre mientras se espera.
  useEffect(() => {
    if (status !== "retrying") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [status]);

  const by = stats?.by_status;
  const total = stats?.total ?? 0;
  const lit = new Set<NodeId>();
  let busy: NodeId | null = null; // borde que gira: hay trabajo en curso en ese nodo
  let waiting = false; // la cola late: hay eventos esperando un reintento
  const share: Record<EdgeId, number> = { in_api: 0, api_q: 0, q_w: 0, w_d: 0, w_f: 0, w_q: 0 };
  const flowing = new Set<EdgeId>();
  let caption: string;

  if (event && edge) {
    BEHIND[edge].forEach((n) => lit.add(n));
    busy = TARGET[edge];
    caption = edge === "in_api" || edge === "api_q"
      ? "Webhook recibido: se comprueba la firma y se guarda en la cola antes de responder 202."
      : `Intento ${Math.max(1, attempts)}: el worker lo toma de la cola y llama al destino.`;
  } else if (event) {
    const last = event.attempt_history.at(-1);
    const code = last ? (last.http_status ?? "sin respuesta (timeout)") : "";
    const done: Record<Status, NodeId[]> = {
      received: ["in", "api", "q"],
      processing: ["in", "api", "q"],
      retrying: ["in", "api", "q"],
      delivered: ["in", "api", "q", "w", "d"],
      dead: ["in", "api", "q", "w", "f"],
    };
    done[event.status].forEach((n) => lit.add(n));
    (["in_api", "api_q"] as EdgeId[]).forEach((id) => (share[id] = 0.3));
    if (event.status === "processing") { busy = "w"; flowing.add("q_w"); }
    if (event.status === "retrying") { waiting = true; flowing.add("w_q"); }
    if (event.status === "delivered") share.q_w = share.w_d = 0.3;
    if (event.status === "dead") share.q_w = share.w_f = 0.3;
    caption = {
      received: "En la cola: el worker lo tomará en su próximo ciclo.",
      processing: `Intento ${attempts + 1} en curso.`,
      retrying: `El intento ${attempts} falló (${code}). Espera con backoff y jitter antes de volver a intentar.`,
      delivered: attempts === 1 ? "Entregado al primer intento." : `Entregado al intento ${attempts}, tras ${attempts - 1} fallo(s).`,
      dead: typeof code === "number" && code < 500 && code !== 429
        ? `El destino respondió ${code}: es un error permanente y no se reintenta. Un admin puede reprocesarlo.`
        : `Se agotaron los ${attempts} intentos. Un admin puede reprocesarlo.`,
    }[event.status];
  } else if (by && total > 0) {
    const inFlight = by.received + by.processing + by.retrying;
    share.in_api = share.api_q = share.q_w = 1;
    share.w_d = by.delivered / total;
    share.w_f = by.dead / total;
    share.w_q = by.retrying / total;
    // El flujo solo se mueve por donde pasaron eventos.
    (Object.keys(share) as EdgeId[]).forEach((id) => share[id] > 0 && flowing.add(id));
    if (by.processing > 0) busy = "w";
    waiting = by.retrying > 0;
    caption = `${total} eventos recibidos, ${inFlight} en curso. Elige un escenario y sigue su recorrido.`;
  } else {
    caption = "Aún no hay eventos. Elige un escenario y sigue su recorrido.";
  }

  const cls = (n: NodeId) => `node n-${n} ${busy === n ? "busy" : lit.has(n) ? "lit" : ""}`;
  const wait = event?.status === "retrying" && !edge
    ? Math.max(0, (new Date(event.next_attempt_at + "Z").getTime() - now) / 1000)
    : null;

  return (
    <section className="flow glow" aria-label={event ? "Recorrido de este evento" : "Recorrido de los eventos"}>
      <div className="flow-scroll">
        <div className="flow-stage">
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
              <filter id="halo" x="-300%" y="-300%" width="700%" height="700%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            {(Object.keys(EDGES) as EdgeId[]).map((id) => (
              <g key={id} className={`edge e-${id}`}>
                <path
                  ref={(el) => void (paths.current[id] = el)}
                  d={EDGES[id]}
                  className="edge-track"
                  strokeWidth={2 + 10 * share[id]}
                  style={{ opacity: share[id] > 0 || flowing.has(id) ? 0.45 : 0.16 }}
                />
                {flowing.has(id) && <path d={EDGES[id]} className="edge-flow" />}
              </g>
            ))}
            <g ref={dot} className={`dot ${edge ? "on" : ""}`}>
              <circle r="11" filter="url(#halo)" />
              <circle r="4.5" className="dot-core" />
            </g>
          </svg>

          <div className={cls("in")} style={at(90, 105)}>
            <span className="node-label">Webhook</span>
            {event ? <strong className="node-title">{event.event_type}</strong> : <strong className="node-count">{total}</strong>}
            <span className="node-sub">{event ? "firmado con HMAC" : "recibidos"}</span>
          </div>

          <div className={cls("api")} style={at(300, 105)}>
            <span className="node-label">API</span>
            <strong className="node-title">{event ? "202 aceptado" : "Firma e idempotencia"}</strong>
            <span className="node-sub">guarda y responde rápido</span>
          </div>

          <div className={`${cls("q")} ${waiting && !edge ? "waiting" : ""}`} style={at(520, 105)}>
            <span className="node-label">Cola</span>
            {event
              ? <strong className="node-title">{wait !== null ? `reintenta en ${fmtSeconds(wait)}` : event.status === "received" && !edge ? "en espera" : "outbox"}</strong>
              : <strong className="node-count">{by ? by.received + by.retrying : 0}</strong>}
            <span className="node-sub">{event ? "la base de datos es la cola" : `${by?.retrying ?? 0} esperando reintento`}</span>
          </div>

          <div className={cls("w")} style={at(760, 105)}>
            <span className="node-label">Worker</span>
            {event
              ? <strong className="node-title">{attempts === 1 ? "1 intento" : `${attempts} intentos`}</strong>
              : <strong className="node-count">{by?.processing ?? 0}</strong>}
            <span className="node-sub">{event || !stats?.avg_attempts ? "backoff exponencial y jitter" : `${stats.avg_attempts} intentos de media`}</span>
          </div>

          <div className={cls("d")} style={at(1000, 105)}>
            <span className="node-label">Destino</span>
            {event ? <strong className="node-title">{destination}</strong> : <strong className="node-count">{by?.delivered ?? 0}</strong>}
            <span className="node-sub">{event ? "Idempotency-Key" : `entregados · ${destination}`}</span>
          </div>

          <a className={cls("f")} style={at(1000, 255)} href="#/dead">
            <span className="node-label">Fallidos</span>
            {event
              ? <strong className="node-title">{event.status === "dead" && !edge ? "espera reproceso" : "sin fallo"}</strong>
              : <strong className="node-count">{by?.dead ?? 0}</strong>}
            <span className="node-sub">reproceso manual (admin)</span>
          </a>
        </div>
      </div>
      <p className="flow-caption" aria-live="polite">{caption}</p>
    </section>
  );
}

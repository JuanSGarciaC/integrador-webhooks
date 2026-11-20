import { useEffect, useRef, useState } from "react";
import FlowCanvas, { createEngine } from "./FlowCanvas";
import {
  attemptLegs, createSim, entryLegs, extend, parkedAt, processingLegs, QUEUE, spawn, statsLegs, waitLegs, WORKER,
  type Counts, type Sampler,
} from "./flowSim";
import { CountUp, fmtSeconds } from "./pages/shared";
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

const at = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

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
  const seen = useRef("");
  const seenAttempts = useRef(0);
  const prevCounts = useRef<Counts | null>(null);
  // Intento que está mostrando el canvas (los datos del sondeo pueden ir por delante de la animación).
  const shown = useRef(0);
  // Sin movimiento pedido por el sistema: ni canvas ni simulación, solo el estado real.
  const [still] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [engine] = useState(() => createEngine(createSim()));
  // Arista que recorre una entrega ahora mismo; null = quieto, el lienzo muestra el estado real.
  const [edge, setEdge] = useState<EdgeId | null>(null);
  const [now, setNow] = useState(Date.now);

  const attempts = event?.attempts ?? 0;
  // Un reproceso deja el evento en retrying con 0 intentos: para el lienzo está en la cola, sin fallo previo.
  const status = event?.status === "retrying" && attempts === 0 ? "received" : event?.status;

  const sample: Sampler = (id, t) => {
    const path = paths.current[id as EdgeId];
    if (!path) return { x: 0, y: 0 };
    const p = path.getPointAtLength(path.getTotalLength() * t);
    return { x: p.x, y: p.y };
  };

  // Detalle: cada cambio de estado se traduce en tramos con los códigos reales de los intentos.
  useEffect(() => {
    if (!event || still) return;
    const key = `${status}:${attempts}`;
    const first = seen.current === "";
    if (seen.current === key) return;
    seen.current = key;
    let done = seenAttempts.current;
    seenAttempts.current = attempts;
    const { sim } = engine;
    let p = sim.particles[0];
    if (first) {
      if (justCreated.id !== event.id) {
        // Evento ya existente: se muestra tal como está, sin recorrido.
        shown.current = status === "processing" ? attempts + 1 : attempts;
        if (status === "retrying") spawn(sim, waitLegs(), { x: QUEUE.x - 92, y: QUEUE.y });
        if (status === "processing") spawn(sim, processingLegs().slice(-1), WORKER);
        if (status === "dead") sim.pile = 1;
        return engine.wake();
      }
      p = spawn(sim, entryLegs(), sample("in_api", 0));
      done = 0;
    }
    p ??= spawn(sim, waitLegs(), { x: QUEUE.x - 92, y: QUEUE.y });
    const codes = event.attempt_history.slice(done).map((a) => a.http_status);
    const atWorker = parkedAt(p) === WORKER;
    if (status === "delivered" || status === "dead" || status === "retrying") {
      if (codes.length) extend(p, attemptLegs(codes, status, atWorker));
    } else if (status === "processing") {
      if (codes.length) extend(p, attemptLegs(codes, "retrying", atWorker));
      if (codes.length || !atWorker) extend(p, processingLegs());
    }
    engine.wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, status, attempts]);

  // Resumen: solo salen partículas por lo que cambió entre dos sondeos de /api/stats.
  useEffect(() => {
    if (!stats || event || still) return;
    const counts: Counts = { total: stats.total, ...stats.by_status };
    const { sim } = engine;
    if (prevCounts.current) {
      const cap = matchMedia("(max-width: 600px)").matches ? 3 : 6;
      for (const legs of statsLegs(prevCounts.current, counts, cap)) spawn(sim, legs, sample((legs[0] as { path: string }).path, 0));
    }
    // La pila refleja los fallidos reales menos los que aún van de camino hacia ella.
    const inFlight = sim.particles.filter((p) => p.legs.at(-1)?.type === "pile").length;
    sim.pile = Math.max(0, counts.dead - inFlight);
    prevCounts.current = counts;
    engine.wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

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
    const n = Math.max(1, shown.current);
    caption = edge === "in_api" || edge === "api_q"
      ? "Webhook recibido: se comprueba la firma y se guarda en la cola antes de responder 202."
      : edge === "w_q"
        ? `El intento ${n} falló: vuelve a la cola a esperar con backoff y jitter.`
        : edge === "w_f"
          ? `El intento ${n} falló y no se reintenta más: va a la cola de fallidos.`
          : `Intento ${n}: el worker lo toma de la cola y llama al destino.`;
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
    done[status!].forEach((n) => lit.add(n));
    (["in_api", "api_q"] as EdgeId[]).forEach((id) => (share[id] = 0.3));
    if (status === "processing") { busy = "w"; flowing.add("q_w"); }
    if (status === "retrying") { waiting = true; flowing.add("w_q"); }
    if (status === "delivered") share.q_w = share.w_d = 0.3;
    if (status === "dead") share.q_w = share.w_f = 0.3;
    caption = {
      received: "En la cola: el worker lo tomará en su próximo ciclo.",
      processing: `Intento ${attempts + 1} en curso.`,
      retrying: `El intento ${attempts} falló (${code}). Espera con backoff y jitter antes de volver a intentar.`,
      delivered: attempts === 1 ? "Entregado al primer intento." : `Entregado al intento ${attempts}, tras ${attempts - 1} fallo(s).`,
      dead: typeof code === "number" && code < 500 && code !== 429
        ? `El destino respondió ${code}: es un error permanente y no se reintenta. Un admin puede reprocesarlo.`
        : `Se agotaron los ${attempts} intentos. Un admin puede reprocesarlo.`,
    }[status!];
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
  // La espera total sale de dos horas del servidor; el reloj del navegador solo la descuenta, con ese tope.
  const ms = (iso: string) => new Date(iso + "Z").getTime();
  const lastAt = event?.attempt_history.at(-1)?.attempted_at;
  const wait = event && status === "retrying" && !edge && lastAt
    ? Math.min(ms(event.next_attempt_at) - ms(lastAt), Math.max(0, ms(event.next_attempt_at) - now)) / 1000
    : null;
  // El canvas dibuja la misma cuenta atrás como un anillo que se cierra alrededor de la cola.
  useEffect(() => {
    engine.ring = wait !== null && lastAt
      ? { until: performance.now() + wait * 1000, total: Math.max(1, ms(event!.next_attempt_at) - ms(lastAt)) }
      : null;
  });

  return (
    <section className="flow glow" aria-label={event ? "Recorrido de este evento" : "Recorrido de los eventos"}>
      {/* En pantalla estrecha el lienzo se desplaza: enfocable para poder hacerlo con el teclado. */}
      <div className="flow-scroll" tabIndex={0} role="group" aria-label="Lienzo, desplazable en horizontal">
        <div className="flow-stage">
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
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
          </svg>
          {!still && (
            <FlowCanvas
              engine={engine}
              sample={sample}
              onLeg={(id) => {
                if (id === "q_w") shown.current++; // cada intento empieza al salir de la cola
                if (id in EDGES) setEdge(id as EdgeId);
              }}
              onSettled={() => {
                justCreated.id = ""; // al reabrir este evento ya no se repite la entrada
                setEdge(null);
              }}
            />
          )}

          <div className={cls("in")} style={at(90, 105)}>
            <span className="node-label">Webhook</span>
            {event ? <strong className="node-title">{event.event_type}</strong> : <strong className="node-count"><CountUp value={total} /></strong>}
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
              ? <strong className="node-title">{wait !== null ? `reintenta en ${fmtSeconds(wait)}` : status === "received" && !edge ? "en espera" : "outbox"}</strong>
              : <strong className="node-count"><CountUp value={by ? by.received + by.retrying : 0} /></strong>}
            <span className="node-sub">{event ? "la base de datos es la cola" : `${by?.retrying ?? 0} esperando reintento`}</span>
          </div>

          <div className={cls("w")} style={at(760, 105)}>
            <span className="node-label">Worker</span>
            {event
              ? <strong className="node-title">{attempts === 1 ? "1 intento" : `${attempts} intentos`}</strong>
              : <strong className="node-count"><CountUp value={by?.processing ?? 0} /></strong>}
            <span className="node-sub">{event || !stats?.avg_attempts ? "backoff exponencial y jitter" : `${stats.avg_attempts} intentos de media`}</span>
          </div>

          <div className={cls("d")} style={at(1000, 105)}>
            <span className="node-label">Destino</span>
            {event ? <strong className="node-title">{destination}</strong> : <strong className="node-count"><CountUp value={by?.delivered ?? 0} /></strong>}
            <span className="node-sub">{event ? "Idempotency-Key" : `entregados · ${destination}`}</span>
          </div>

          <a className={cls("f")} style={at(1000, 255)} href="#/dead">
            <span className="node-label">Fallidos</span>
            {event
              ? <strong className="node-title">{status === "dead" && !edge ? "espera reproceso" : "sin fallo"}</strong>
              : <strong className="node-count"><CountUp value={by?.dead ?? 0} /></strong>}
            <span className="node-sub">reproceso manual (admin)</span>
          </a>
        </div>
      </div>
      <p className="flow-caption" aria-live="polite">{caption}</p>
    </section>
  );
}

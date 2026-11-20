// Simulación del lienzo: lógica pura, sin DOM ni reloj. Quien la usa le pasa el tiempo
// transcurrido (dt, ms) y una función que da el punto de una ruta; así se prueba sin esperar.

export type Pt = { x: number; y: number };
/** Punto de la ruta `path` en la fracción `t` (0..1) de su longitud, en coordenadas del viewBox. */
export type Sampler = (path: string, t: number) => Pt;
export type Tone = "ok" | "retry" | "fail" | "info";

export type Leg =
  | { type: "path"; path: string; from: number; to: number; dur: number }
  /** Línea recta desde donde esté la partícula hasta el punto `t` de `path`. */
  | { type: "goto"; path: string; t: number; dur: number }
  /** Destello al chocar; `code` undefined = sin rótulo (el sondeo de stats no sabe el código). */
  | { type: "hit"; tone: Tone; code?: number | null }
  /** Órbita alrededor de un nodo hasta que lleguen tramos nuevos. */
  | { type: "park"; at: Pt; rx: number; ry: number }
  | { type: "absorb"; tone: Tone }
  | { type: "pile" };

export interface Particle {
  id: number;
  legs: Leg[];
  leg: number;
  /** Tiempo dentro del tramo actual (ms). */
  t: number;
  pos: Pt;
  /** Punto de salida del tramo actual (goto y park lo necesitan). */
  origin: Pt;
  angle: number;
  trail: Pt[];
  done: boolean;
}

export interface Burst { pos: Pt; tone: Tone; label: string; age: number }

export interface Sim { particles: Particle[]; bursts: Burst[]; pile: number; next: number }

export const BURST_MS = 700;
const TRAVEL = 480; // mismo ritmo que el punto del lienzo anterior
const BOUNCE = 320;
const HOP = 160;
const TRAIL = 10;
const ORBIT = 2.4; // rad/s

// Centros de los nodos en el viewBox (los mismos que usa Flow.tsx).
export const QUEUE: Pt = { x: 520, y: 105 };
export const WORKER: Pt = { x: 760, y: 105 };
const parkQueue: Leg = { type: "park", at: QUEUE, rx: 92, ry: 56 };
const parkWorker: Leg = { type: "park", at: WORKER, rx: 6, ry: 4 }; // queda oculta bajo el nodo

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Mismo criterio que `classify` del worker: 2xx entrega, 429/5xx/timeout reintenta, otro 4xx es permanente. */
export const tone = (code: number | null): Tone =>
  code === null || code === 429 || code >= 500 ? "retry" : code < 300 ? "ok" : "fail";

const path = (p: string, from = 0, to = 1, dur = TRAVEL): Leg => ({ type: "path", path: p, from, to, dur });

export const entryLegs = (): Leg[] => [path("in_api"), path("api_q"), parkQueue];

export const processingLegs = (): Leg[] => [{ type: "goto", path: "q_w", t: 0, dur: HOP }, path("q_w"), parkWorker];

/**
 * Tramos de uno o varios intentos seguidos. `codes` son las respuestas del destino en orden;
 * `final` es el estado al terminar el último; `atWorker` = la partícula ya está dentro del worker.
 */
export function attemptLegs(codes: (number | null)[], final: "retrying" | "delivered" | "dead", atWorker: boolean): Leg[] {
  const legs: Leg[] = [];
  codes.forEach((code, i) => {
    if (i > 0 || !atWorker) legs.push({ type: "goto", path: "q_w", t: 0, dur: HOP }, path("q_w"));
    const result = tone(code);
    legs.push(path("w_d", 0, 0.9), { type: "hit", tone: result, code });
    if (result === "ok") {
      legs.push(path("w_d", 0.9, 1, 120), { type: "absorb", tone: "ok" });
      return;
    }
    legs.push(path("w_d", 0.9, 0, BOUNCE)); // rebote de vuelta al worker
    if (i === codes.length - 1 && final === "dead") legs.push(path("w_f"), { type: "pile" });
    else {
      legs.push({ type: "goto", path: "w_q", t: 0, dur: HOP }, path("w_q"));
      if (i === codes.length - 1) legs.push(parkQueue); // espera real del backoff
    }
  });
  return legs;
}

export interface Counts { total: number; received: number; processing: number; retrying: number; delivered: number; dead: number }

/** Partículas para lo que cambió entre dos sondeos de /api/stats. Solo cuenta lo que sube. */
export function statsLegs(prev: Counts, next: Counts, cap = 6): Leg[][] {
  const up = (k: keyof Counts) => Math.max(0, next[k] - prev[k]);
  const routes: Leg[][] = [];
  const add = (n: number, legs: () => Leg[]) => {
    for (let i = 0; i < n && routes.length < cap; i++) routes.push(legs());
  };
  add(up("dead"), () => [path("q_w"), path("w_d", 0, 0.9), { type: "hit", tone: "fail" },
    path("w_d", 0.9, 0, BOUNCE), path("w_f"), { type: "pile" }]);
  add(up("delivered"), () => [path("q_w"), path("w_d"), { type: "absorb", tone: "ok" }]);
  add(up("total"), () => [path("in_api"), path("api_q"), { type: "absorb", tone: "info" }]);
  return routes;
}

export const createSim = (pile = 0): Sim => ({ particles: [], bursts: [], pile, next: 1 });

export function spawn(sim: Sim, legs: Leg[], start: Pt = { x: 0, y: 0 }): Particle {
  const p: Particle = { id: sim.next++, legs, leg: 0, t: 0, pos: { ...start }, origin: { ...start }, angle: 0, trail: [], done: false };
  sim.particles.push(p);
  return p;
}

export function extend(p: Particle, legs: Leg[]) {
  p.legs.push(...legs);
}

/** Hay alguna partícula viajando (no aparcada). */
export const moving = (sim: Sim) =>
  sim.particles.some((p) => !p.done && (p.legs[p.leg]?.type !== "park" || p.leg < p.legs.length - 1));

/** Avanza `dt` ms. Devuelve las rutas (`path`) que empezaron en este paso, en orden. */
export function step(sim: Sim, dt: number, sample: Sampler): string[] {
  const started: string[] = [];
  for (const p of sim.particles) advance(sim, p, dt, sample, started);
  sim.particles = sim.particles.filter((p) => !p.done);
  sim.bursts.forEach((b) => (b.age += dt));
  sim.bursts = sim.bursts.filter((b) => b.age < BURST_MS);
  return started;
}

function advance(sim: Sim, p: Particle, dt: number, sample: Sampler, started: string[]) {
  let left = dt;
  while (!p.done && p.leg < p.legs.length) {
    const leg = p.legs[p.leg];
    if (p.t === 0 && left <= 0) break; // sin tiempo en este paso: el tramo empieza en el siguiente
    if (p.t === 0) {
      p.origin = { ...p.pos };
      if (leg.type === "path") started.push(leg.path);
      if (leg.type === "park") {
        // Arranca la órbita desde donde llega, sin saltos.
        p.angle = Math.atan2((p.pos.y - leg.at.y) / leg.ry, (p.pos.x - leg.at.x) / leg.rx);
      }
    }
    if (leg.type === "hit") {
      sim.bursts.push({ pos: { ...p.pos }, tone: leg.tone, label: leg.code === undefined ? "" : String(leg.code ?? "timeout"), age: 0 });
      next(p);
      continue;
    }
    if (leg.type === "absorb" || leg.type === "pile") {
      if (leg.type === "pile") sim.pile++;
      else sim.bursts.push({ pos: { ...p.pos }, tone: leg.tone, label: "", age: 0 });
      p.done = true;
      break;
    }
    if (leg.type === "park") {
      const last = p.leg === p.legs.length - 1;
      if (!last && p.t > 0) { next(p); continue; } // llegaron tramos nuevos: deja la órbita
      p.t += Math.max(left, 1e-6);
      p.angle += (ORBIT * left) / 1000;
      // El radio crece desde donde llegó hasta la órbita en 300 ms.
      const d0 = Math.hypot((p.origin.x - leg.at.x) / leg.rx, (p.origin.y - leg.at.y) / leg.ry);
      const r = d0 + (1 - d0) * Math.min(1, p.t / 300);
      p.pos = { x: leg.at.x + Math.cos(p.angle) * leg.rx * r, y: leg.at.y + Math.sin(p.angle) * leg.ry * r };
      if (!last) { next(p); continue; }
      break;
    }
    // path o goto
    const used = Math.min(left, leg.dur - p.t);
    p.t += used;
    left -= used;
    const f = ease(Math.min(1, p.t / leg.dur));
    if (leg.type === "path") p.pos = sample(leg.path, leg.from + (leg.to - leg.from) * f);
    else {
      const to = sample(leg.path, leg.t);
      p.pos = { x: p.origin.x + (to.x - p.origin.x) * f, y: p.origin.y + (to.y - p.origin.y) * f };
    }
    if (p.t >= leg.dur) next(p);
    else break;
  }
  p.trail.unshift({ ...p.pos });
  if (p.trail.length > TRAIL) p.trail.length = TRAIL;
}

function next(p: Particle) {
  p.leg++;
  p.t = 0;
}

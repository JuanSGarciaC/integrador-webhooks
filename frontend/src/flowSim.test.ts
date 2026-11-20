import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  attemptLegs, BURST_MS, createSim, entryLegs, extend, moving, processingLegs, spawn, statsLegs, step, tone,
  type Leg, type Sampler,
} from "./flowSim.ts";

// Muestreador falso: cada ruta es una recta horizontal en y = índice; x = t * 100.
// Así la posición dice en qué ruta y en qué punto está la partícula sin depender del SVG.
const ROUTES = ["in_api", "api_q", "q_w", "w_d", "w_f", "w_q"];
const sample: Sampler = (path, t) => ({ x: t * 100, y: ROUTES.indexOf(path) });

const types = (legs: Leg[]) => legs.map((l) => (l.type === "path" || l.type === "goto" ? `${l.type}:${l.path}` : l.type));

/** Avanza la simulación en pasos de 16 ms (como un frame) hasta consumir `ms`. */
function run(sim: ReturnType<typeof createSim>, ms: number, started: string[] = []) {
  for (let t = 0; t < ms; t += 16) started.push(...step(sim, 16, sample));
  return started;
}

describe("tone: mismo criterio que el worker", () => {
  test("2xx entrega, 429/5xx/timeout reintenta, el resto de 4xx falla", () => {
    assert.equal(tone(200), "ok");
    assert.equal(tone(201), "ok");
    assert.equal(tone(503), "retry");
    assert.equal(tone(429), "retry");
    assert.equal(tone(null), "retry");
    assert.equal(tone(422), "fail");
  });
});

describe("rutas", () => {
  test("la entrada recorre webhook → API → cola y espera allí", () => {
    assert.deepEqual(types(entryLegs()), ["path:in_api", "path:api_q", "park"]);
  });

  test("procesando: sale de la cola y espera dentro del worker", () => {
    assert.deepEqual(types(processingLegs()), ["goto:q_w", "path:q_w", "park"]);
  });

  test("un 503 choca contra el destino, rebota y vuelve a la cola", () => {
    assert.deepEqual(types(attemptLegs([503], "retrying", true)), [
      "path:w_d", "hit", "path:w_d", "goto:w_q", "path:w_q", "park",
    ]);
  });

  test("un 200 llega al destino y se absorbe", () => {
    assert.deepEqual(types(attemptLegs([200], "delivered", true)), ["path:w_d", "hit", "path:w_d", "absorb"]);
  });

  test("un 422 rebota y cae a fallidos", () => {
    assert.deepEqual(types(attemptLegs([422], "dead", true)), ["path:w_d", "hit", "path:w_d", "path:w_f", "pile"]);
  });

  test("si el sondeo se saltó intentos, los recorre todos sin pararse en la cola", () => {
    const legs = attemptLegs([503, 503, 200], "delivered", false);
    assert.equal(legs.filter((l) => l.type === "hit").length, 3);
    assert.equal(legs.filter((l) => l.type === "park").length, 0);
    assert.equal(types(legs)[0], "goto:q_w"); // estaba en la cola: primero vuelve al worker
    assert.equal(legs.at(-1)!.type, "absorb");
  });

  test("intentos agotados con 503: el último también rebota y cae a fallidos", () => {
    const legs = attemptLegs([503, 503], "dead", true);
    assert.deepEqual(types(legs).slice(-3), ["path:w_d", "path:w_f", "pile"]);
  });
});

describe("step: el tiempo lo da quien llama", () => {
  test("una partícula recorre su ruta en el tiempo indicado", () => {
    const sim = createSim();
    const p = spawn(sim, [{ type: "path", path: "w_d", from: 0, to: 1, dur: 100 }]);
    step(sim, 50, sample);
    assert.ok(p.pos.x > 0 && p.pos.x < 100, `a mitad de camino, x=${p.pos.x}`);
    step(sim, 60, sample);
    assert.equal(p.pos.x, 100);
    assert.equal(p.pos.y, ROUTES.indexOf("w_d"));
  });

  test("devuelve las rutas que empiezan en este paso", () => {
    const sim = createSim();
    spawn(sim, entryLegs());
    const started = run(sim, 2000);
    assert.deepEqual(started, ["in_api", "api_q"]);
  });

  test("el choque deja un destello con el código y desaparece pasado BURST_MS", () => {
    const sim = createSim();
    spawn(sim, attemptLegs([503], "retrying", true));
    run(sim, 600);
    assert.equal(sim.bursts.length, 1);
    assert.equal(sim.bursts[0].label, "503");
    assert.equal(sim.bursts[0].tone, "retry");
    run(sim, BURST_MS + 100);
    assert.equal(sim.bursts.length, 0);
  });

  test("timeout se rotula como tal", () => {
    const sim = createSim();
    spawn(sim, attemptLegs([null], "retrying", true));
    run(sim, 600);
    assert.equal(sim.bursts[0].label, "timeout");
  });

  test("aparcada en la cola gira sin terminar y deja de contar como movimiento", () => {
    const sim = createSim();
    const p = spawn(sim, attemptLegs([503], "retrying", true));
    run(sim, 5000);
    assert.equal(p.done, false);
    assert.equal(moving(sim), false);
    const before = { ...p.pos };
    run(sim, 200);
    assert.notDeepEqual(p.pos, before, "sigue orbitando");
  });

  test("al extender una partícula aparcada continúa con el siguiente intento", () => {
    const sim = createSim();
    const p = spawn(sim, attemptLegs([503], "retrying", true));
    run(sim, 5000);
    extend(p, attemptLegs([200], "delivered", false));
    assert.equal(moving(sim), true);
    run(sim, 5000);
    assert.equal(p.done, true);
    assert.equal(sim.particles.length, 0, "las terminadas se retiran");
  });

  test("las fallidas se apilan en la cola de fallidos", () => {
    const sim = createSim(2);
    spawn(sim, attemptLegs([422], "dead", true));
    run(sim, 5000);
    assert.equal(sim.pile, 3);
  });

  test("con varios intentos acumulados va más rápido para alcanzar a los datos", () => {
    const legs = attemptLegs([503, 503, 200], "delivered", false);
    const total = legs.reduce((t, l) => t + (l.type === "path" || l.type === "goto" ? l.dur : 0), 0);
    const sim = createSim();
    spawn(sim, legs);
    run(sim, total * 0.75);
    assert.equal(sim.particles.length, 0, "terminó antes de la suma de duraciones");
  });

  test("con un solo intento pendiente va a velocidad normal", () => {
    const sim = createSim();
    spawn(sim, attemptLegs([200], "delivered", true));
    run(sim, 400);
    assert.equal(sim.particles.length, 1);
  });

  test("un paso enorme (pestaña dormida) no deja la partícula a medias", () => {
    const sim = createSim();
    spawn(sim, attemptLegs([200], "delivered", true));
    step(sim, 60_000, sample);
    assert.equal(sim.particles.length, 0);
  });
});

describe("statsLegs: solo cambios reales del sondeo", () => {
  const base = { total: 10, received: 0, processing: 0, retrying: 0, delivered: 8, dead: 2 };

  test("sin cambios no sale ninguna partícula", () => {
    assert.equal(statsLegs(base, base).length, 0);
  });

  test("un evento nuevo entra y uno entregado llega al destino", () => {
    const next = { ...base, total: 11, delivered: 9 };
    const routes = statsLegs(base, next).map(types);
    assert.deepEqual(routes.filter((r) => r[0] === "path:in_api").length, 1);
    assert.deepEqual(routes.filter((r) => r.at(-1) === "absorb" && r.includes("path:w_d")).length, 1);
  });

  test("un fallido nuevo cae a la pila", () => {
    const routes = statsLegs(base, { ...base, dead: 3 }).map(types);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].at(-1), "pile");
  });

  test("con un salto grande limita las partículas por sondeo", () => {
    const routes = statsLegs(base, { ...base, total: 200, delivered: 190 }, 6);
    assert.ok(routes.length <= 6);
  });

  test("varias del mismo tipo salen escalonadas, no superpuestas", () => {
    const routes = statsLegs(base, { ...base, total: 13 });
    const durs = routes.map((r) => (r[0].type === "path" ? r[0].dur : 0));
    assert.equal(new Set(durs).size, 3);
  });

  test("los conteos que bajan (reproceso) no generan partículas", () => {
    assert.equal(statsLegs(base, { ...base, dead: 1, received: 1 }).length, 0);
  });
});

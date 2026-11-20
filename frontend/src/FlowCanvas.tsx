import { useEffect, useRef } from "react";
import { BURST_MS, moving, QUEUE, step, type Particle, type Sampler, type Sim, type Tone } from "./flowSim";

const W = 1100;
const H = 320;
const FAILED = { x: 1000, y: 306 }; // bajo el nodo Fallidos: allí se apilan
const PILE_MAX = 15;

/** Puente entre Flow (datos) y el canvas (dibujo). Flow lo crea; el canvas rellena `wake`. */
export interface Engine {
  sim: Sim;
  /** Arranca el bucle si estaba parado (hay algo nuevo que dibujar). */
  wake: () => void;
  /** Cuenta atrás del backoff: instante (performance.now) del próximo intento y duración total, en ms. */
  ring: { until: number; total: number } | null;
}

export const createEngine = (sim: Sim): Engine => ({ sim, wake: () => {}, ring: null });

interface Props {
  engine: Engine;
  sample: Sampler;
  /** Empieza a recorrerse una ruta: Flow enciende los nodos que tocan. */
  onLeg: (path: string) => void;
  /** Ya no queda nada viajando (puede haber partículas esperando en la cola). */
  onSettled: () => void;
}

export default function FlowCanvas({ engine, sample, onLeg, onSettled }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Las funciones de Flow cambian en cada render; el bucle lee siempre la última.
  const cb = useRef({ sample, onLeg, onSettled });
  cb.current = { sample, onLeg, onSettled };

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return; // sin canvas el lienzo SVG sigue mostrando el estado real
    const css = getComputedStyle(el);
    const color: Record<Tone, string> = {
      ok: css.getPropertyValue("--ok").trim() || "#4ade9a",
      retry: css.getPropertyValue("--warn").trim() || "#ffb454",
      fail: css.getPropertyValue("--bad").trim() || "#ff8278",
      info: css.getPropertyValue("--accent").trim() || "#56d4ff",
    };
    // Pantalla estrecha: sin estela, halo ni chispas.
    const lite = matchMedia("(max-width: 600px)").matches;
    let raf = 0;
    let last = 0;
    let visible = true;
    let wasMoving = false;

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      ctx.setTransform(el.width / W, 0, 0, el.height / H, 0, 0); // se dibuja en coordenadas del viewBox
      draw();
    };

    const tint = (p: Particle) => {
      for (let i = p.leg; i >= 0; i--) {
        const l = p.legs[i];
        if (l?.type === "hit") return color[l.tone];
      }
      return color.info;
    };

    function draw() {
      const { sim, ring } = engine;
      ctx!.clearRect(0, 0, W, H);

      // Cola de fallidos: un punto por evento, el destino visible de lo que no se pudo entregar.
      const n = Math.min(sim.pile, PILE_MAX);
      ctx!.fillStyle = color.fail;
      for (let i = 0; i < n; i++) {
        ctx!.globalAlpha = 0.55 + 0.45 * (i / Math.max(1, n - 1));
        ctx!.beginPath();
        ctx!.arc(FAILED.x - ((n - 1) * 9) / 2 + i * 9, FAILED.y, 3, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // Anillo del backoff: lo que queda de espera hasta el próximo intento.
      const parked = sim.particles.some((p) => p.legs[p.leg]?.type === "park" && p.legs.at(-1) === p.legs[p.leg]);
      if (ring && parked) {
        const left = Math.max(0, Math.min(1, (ring.until - performance.now()) / ring.total));
        ctx!.lineWidth = 2;
        ctx!.strokeStyle = "rgb(255 255 255 / .08)";
        ctx!.beginPath();
        ctx!.ellipse(QUEUE.x, QUEUE.y, 92, 56, 0, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.strokeStyle = color.retry;
        ctx!.beginPath();
        ctx!.ellipse(QUEUE.x, QUEUE.y, 92, 56, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
        ctx!.stroke();
      }

      for (const p of sim.particles) {
        const c = tint(p);
        if (!lite) {
          p.trail.forEach((t, i) => {
            ctx!.globalAlpha = 0.35 * (1 - i / p.trail.length);
            ctx!.fillStyle = c;
            ctx!.beginPath();
            ctx!.arc(t.x, t.y, 4 - i * 0.3, 0, Math.PI * 2);
            ctx!.fill();
          });
          ctx!.globalAlpha = 1;
          const g = ctx!.createRadialGradient(p.pos.x, p.pos.y, 0, p.pos.x, p.pos.y, 14);
          g.addColorStop(0, c);
          g.addColorStop(1, "transparent");
          ctx!.globalAlpha = 0.6;
          ctx!.fillStyle = g;
          ctx!.fillRect(p.pos.x - 14, p.pos.y - 14, 28, 28);
          ctx!.globalAlpha = 1;
        }
        ctx!.fillStyle = "#fff";
        ctx!.strokeStyle = c;
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(p.pos.x, p.pos.y, 4.5, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.stroke();
      }

      for (const b of sim.bursts) {
        const k = b.age / BURST_MS;
        const c = color[b.tone];
        ctx!.globalAlpha = 1 - k;
        ctx!.strokeStyle = c;
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(b.pos.x, b.pos.y, 6 + 26 * k, 0, Math.PI * 2);
        ctx!.stroke();
        if (!lite) {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + 0.4;
            const r0 = 8 + 20 * k;
            ctx!.beginPath();
            ctx!.moveTo(b.pos.x + Math.cos(a) * r0, b.pos.y + Math.sin(a) * r0);
            ctx!.lineTo(b.pos.x + Math.cos(a) * (r0 + 6), b.pos.y + Math.sin(a) * (r0 + 6));
            ctx!.stroke();
          }
        }
        if (b.label) {
          ctx!.fillStyle = c;
          ctx!.font = "700 15px Sora, system-ui, sans-serif";
          ctx!.textAlign = "center";
          ctx!.fillText(b.label, b.pos.x, b.pos.y - 18 - 18 * k);
        }
      }
      ctx!.globalAlpha = 1;
    }

    const frame = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 0; // tras una pausa no salta: retoma donde estaba
      last = now;
      const { sim } = engine;
      const started = step(sim, dt, cb.current.sample);
      if (started.length) cb.current.onLeg(started.at(-1)!);
      const isMoving = moving(sim);
      if (wasMoving && !isMoving) cb.current.onSettled();
      wasMoving = isMoving;
      draw();
      raf = sim.particles.length || sim.bursts.length ? requestAnimationFrame(frame) : 0;
      if (!raf) last = 0;
    };

    const start = () => {
      if (raf || !visible || document.hidden) return draw();
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    engine.wake = start;

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(el);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      engine.wake = () => {};
    };
  }, [engine]);

  return <canvas ref={canvas} className="flow-canvas" aria-hidden="true" />;
}

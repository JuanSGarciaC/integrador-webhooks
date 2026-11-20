// Líneas de la terminal del detalle, generadas solo con datos reales del evento (sin DOM: se prueba con node --test).
import { tone, type Tone } from "./flowSim.ts";
import type { Attempt, Status } from "./types";

export interface Line { text: string; tone: Tone | "muted" }

interface EventLike { event_type: string; delivery_id: string; status: Status; attempt_history: Attempt[] }

const ms = (iso: string) => new Date(iso + "Z").getTime(); // el backend guarda UTC sin zona
const secs = (a: string, b: string) => `${((ms(b) - ms(a)) / 1000).toFixed(1)} s`;

export function terminalLines(ev: EventLike): Line[] {
  const lines: Line[] = [
    { text: `$ POST /webhooks/github  X-GitHub-Event: ${ev.event_type}  X-Hub-Signature-256 ✓`, tone: "muted" },
    { text: `  202 Accepted · guardado en la cola (delivery ${ev.delivery_id})`, tone: "info" },
  ];
  const h = ev.attempt_history;
  h.forEach((a, i) => {
    const wait = i > 0 ? ` (esperó ${secs(h[i - 1].attempted_at, a.attempted_at)})` : "";
    lines.push({ text: `→ intento ${i + 1} · POST destino${wait}`, tone: "muted" });
    const code = a.http_status ?? "timeout";
    lines.push({ text: `  ← ${code} en ${a.duration_ms} ms`, tone: tone(a.http_status) });
  });
  const last: Record<Status, Line> = {
    received: { text: "  en la cola: el worker lo tomará en su próximo ciclo", tone: "muted" },
    processing: { text: `→ intento ${h.length + 1} · POST destino…`, tone: "muted" },
    retrying: { text: "  en espera: backoff exponencial con jitter antes del siguiente intento", tone: "retry" },
    delivered: { text: `✓ entregado en el intento ${h.length}`, tone: "ok" },
    dead: { text: "✕ movido a la cola de fallidos: un admin puede reprocesarlo", tone: "fail" },
  };
  // Un reproceso deja el evento en retrying con 0 intentos: está en la cola, sin fallo previo.
  lines.push(last[ev.status === "retrying" && h.length === 0 ? "received" : ev.status]);
  return lines;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalLines } from "./terminalLines.ts";

// Datos ficticios con la forma de GET /api/events/{id}; las horas son UTC sin zona, como las guarda el backend.
const base = {
  event_type: "push",
  delivery_id: "abc-123",
  status: "delivered" as const,
  attempt_history: [] as { attempted_at: string; http_status: number | null; duration_ms: number; error: string | null }[],
};
const attempt = (at: string, http_status: number | null, duration_ms = 12) => ({ attempted_at: at, http_status, duration_ms, error: null });

test("la entrada siempre muestra firma y 202", () => {
  const lines = terminalLines({ ...base, status: "received" });
  assert.match(lines[0].text, /POST \/webhooks\/github/);
  assert.match(lines[1].text, /202/);
  assert.match(lines[1].text, /abc-123/);
  assert.match(lines.at(-1)!.text, /en la cola/);
});

test("recuperación: dos 503 con su espera real y un 200", () => {
  const lines = terminalLines({
    ...base,
    attempt_history: [
      attempt("2026-11-20T10:00:00", 503),
      attempt("2026-11-20T10:00:01.5", 503),
      attempt("2026-11-20T10:00:04.5", 200, 30),
    ],
  });
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /intento 1/);
  assert.match(text, /← 503 en 12 ms/);
  assert.match(text, /esperó 1\.5 s/);
  assert.match(text, /esperó 3\.0 s/);
  assert.match(text, /← 200 en 30 ms/);
  assert.equal(lines.at(-1)!.tone, "ok");
  assert.match(lines.at(-1)!.text, /entregado/);
});

test("timeout se escribe como tal y en ámbar", () => {
  const lines = terminalLines({ ...base, status: "retrying", attempt_history: [attempt("2026-11-20T10:00:00", null, 2000)] });
  const res = lines.find((l) => l.text.includes("timeout"))!;
  assert.equal(res.tone, "retry");
  assert.match(lines.at(-1)!.text, /backoff/);
});

test("un 422 va a fallidos sin reintentar", () => {
  const lines = terminalLines({ ...base, status: "dead", attempt_history: [attempt("2026-11-20T10:00:00", 422)] });
  assert.equal(lines.find((l) => l.text.includes("422"))!.tone, "fail");
  assert.match(lines.at(-1)!.text, /fallidos/);
  assert.equal(lines.at(-1)!.tone, "fail");
});

test("procesando: muestra el intento en curso", () => {
  const lines = terminalLines({ ...base, status: "processing" });
  assert.match(lines.at(-1)!.text, /intento 1 · POST destino/);
});

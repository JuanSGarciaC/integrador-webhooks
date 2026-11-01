// Capturas del panel para el README, contra la demo en marcha (contenedor local).
//   docker run -d -p 8080:8080 -e WEBHOOK_SECRET=s -e ADMIN_TOKEN=t -e DEMO_RATE_PER_MINUTE=1000 integrador-demo
//   ADMIN_TOKEN=t OUT=../docs/screenshots node scripts/capture.mjs
// Siembra datos ficticios con el simulador y fotografía cada pantalla (tema claro; el detalle también en oscuro).
// El GIF del README sale de scripts/frames.mjs (fotogramas) unidos con Pillow.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "../docs/screenshots";
const ADMIN = process.env.ADMIN_TOKEN ?? "";
mkdirSync(OUT, { recursive: true });

async function simulate(scenario) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`${BASE}/api/demo/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario }),
    });
    if (r.status === 202) return (await r.json()).id;
    if (r.status !== 429) throw new Error(`simulate ${scenario}: ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 61_000)); // límite por IP de la demo pública: esperar la ventana
  }
  throw new Error(`simulate ${scenario}: sigue en 429`);
}

async function waitFinal(id) {
  for (let i = 0; i < 120; i++) {
    const ev = await (await fetch(`${BASE}/api/events/${id}`)).json();
    if (ev.status === "delivered" || ev.status === "dead") return ev;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${id} no terminó`);
}

const plan = ["ok", "ok", "recover", "rate_limit", "timeout", "rejected", "ok", "recover", "rejected", "ok"];
const ids = [];
for (const s of plan) ids.push([s, await simulate(s)]);
await Promise.all(ids.map(([, id]) => waitFinal(id)));
const recoverId = ids.find(([s]) => s === "recover")[1];

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: scheme, deviceScaleFactor: 1.5 });
  const shot = async (name, hash, ready) => {
    if (scheme === "dark" && name !== "02-detalle-reintentos") return; // en oscuro basta una muestra
    await page.goto(`${BASE}/${hash}`);
    await page.reload(); // el hash no recarga la app: así se aplica el sessionStorage actual
    await ready();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}-${scheme}.png` });
  };
  await shot("01-simular", "#/simulate", () => page.getByRole("heading", { name: "Simular un webhook" }).waitFor());
  const liveId = await simulate("recover"); // en curso: «En vivo» y próximo intento
  await shot("07-en-vivo", `#/events/${liveId}`, () => page.locator("ol.timeline > li").first().waitFor());
  await shot("02-detalle-reintentos", `#/events/${recoverId}`, () => page.locator("ol.timeline > li").nth(2).waitFor());
  await shot("03-eventos", "#/events", () => page.locator("tbody tr").first().waitFor());
  await shot("04-estadisticas", "#/stats", () => page.locator(".card").first().waitFor());
  // Sin token (p. ej. contra la demo pública) se omite la captura como admin.
  if (ADMIN) await page.evaluate((t) => sessionStorage.setItem("adminToken", t), ADMIN);
  if (ADMIN) await shot("05-fallidos-admin", "#/dead", () => page.getByRole("button", { name: "Reprocesar" }).first().waitFor());
  await page.evaluate(() => sessionStorage.removeItem("adminToken"));
  await shot("06-fallidos-visitante", "#/dead", () => page.getByRole("button", { name: "Requiere admin" }).first().waitFor());
  await page.close();
}
await browser.close();
console.log("capturas en", OUT);

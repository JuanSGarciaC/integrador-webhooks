// Capturas del panel para el README, contra la demo en marcha (contenedor local).
//   docker run -d -p 8080:8080 -e WEBHOOK_SECRET=s -e ADMIN_TOKEN=t -e DEMO_RATE_PER_MINUTE=1000 integrador-demo
//   ADMIN_TOKEN=t OUT=../docs/screenshots node scripts/capture.mjs
// Siembra datos ficticios con el simulador y fotografía cada pantalla.
// Con el stack de docker-compose.triaje.yml en marcha, TRIAJE_STACK=http://127.0.0.1:8080 y
// TRIAJE_URL=http://127.0.0.1:8081 añaden las dos capturas de la conexión.
// El GIF del README sale de scripts/frames.mjs (fotogramas) unidos con scripts/gif.py.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "../docs/screenshots";
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const { TRIAJE_STACK, TRIAJE_URL } = process.env;
mkdirSync(OUT, { recursive: true });

async function simulate(scenario, base = BASE) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`${base}/api/demo/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario }),
    });
    if (r.status === 202) return (await r.json()).id;
    if (r.status !== 429) throw new Error(`simulate ${scenario}: ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 61_000)); // límite por IP de la demo pública: esperar la ventana
  }
  throw new Error(`simulate ${scenario}: sigue en 429`);
}

async function waitFinal(id, base = BASE) {
  for (let i = 0; i < 120; i++) {
    const ev = await (await fetch(`${base}/api/events/${id}`)).json();
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
const shot = async (name, url, ready) => {
  await page.goto(url);
  await page.reload(); // el hash no recarga la app: así se aplica el sessionStorage actual
  await ready();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
await shot("01-simular", `${BASE}/#/simulate`, () => page.locator(".node-count").first().waitFor());
// En curso: la cola espera el reintento. La espera lleva jitter y puede ser casi nula, así que se reintenta.
for (let intento = 0; ; intento++) {
  await page.goto(`${BASE}/#/events/${await simulate("recover")}`);
  const visto = await page.getByText(/reintenta en/).waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (visto) { await page.screenshot({ path: `${OUT}/02-en-vivo.png` }); break; }
  if (intento === 5) throw new Error("no se pudo capturar un evento esperando reintento");
}
await shot("03-detalle-entregado", `${BASE}/#/events/${recoverId}`, () => page.locator("ol.timeline > li").nth(2).waitFor());
await shot("04-eventos", `${BASE}/#/events`, () => page.locator("tbody tr").first().waitFor());
await shot("05-estadisticas", `${BASE}/#/stats`, () => page.locator(".card").first().waitFor());
// Sin token (p. ej. contra la demo pública) se omite la captura como admin.
if (ADMIN) await page.evaluate((t) => sessionStorage.setItem("adminToken", t), ADMIN);
if (ADMIN) await shot("06-fallidos-admin", `${BASE}/#/dead`, () => page.getByRole("button", { name: "Reprocesar" }).first().waitFor());
await page.evaluate(() => sessionStorage.removeItem("adminToken"));
await shot("07-fallidos-visitante", `${BASE}/#/dead`, () => page.getByRole("button", { name: "Requiere admin" }).first().waitFor());

if (TRIAJE_STACK && TRIAJE_URL) {
  const id = await simulate("issue", TRIAJE_STACK);
  await waitFinal(id, TRIAJE_STACK);
  await shot("08-issue-en-integrador", `${TRIAJE_STACK}/#/events/${id}`, async () => {
    await page.getByText("Enviado al destino").click();
    await page.getByText('"subject"').waitFor();
  });
  await shot("09-issue-en-triaje", TRIAJE_URL, () => page.getByText("No puedo entrar a mi cuenta").first().waitFor());
}
await browser.close();
console.log("capturas en", OUT);

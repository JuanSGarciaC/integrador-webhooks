// Capturas del panel para el README, contra la demo en marcha (contenedor local o E2E_BASE_URL).
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

// Edge, 1440×900 a escala 2 (nítidas en retina); cada captura se recorta hasta el final del contenido.
const browser = await chromium.launch({ channel: "msedge" });
try {
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const clip = async () => {
  const bottom = await page.locator("main").evaluate((m) => m.getBoundingClientRect().bottom);
  return { x: 0, y: 0, width: 1440, height: Math.ceil(bottom) + 28 }; // hasta el final del contenido, aunque pase del viewport
};
const shot = async (name, url, ready) => {
  await page.goto(url);
  await page.reload(); // el hash no recarga la app: así se aplica el sessionStorage actual
  await ready();
  await page.waitForTimeout(1200); // deja terminar la cascada (A2) y el count-up (A7)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, clip: await clip() });
};
await shot("01-simular", `${BASE}/#/simulate`, () => page.locator(".node-count").first().waitFor());
// En curso: la cola espera el reintento. La espera lleva jitter y puede ser casi nula, así que se reintenta.
for (let intento = 0; ; intento++) {
  await page.goto(`${BASE}/#/events/${await simulate("recover")}`);
  // 10 s: cubre también el 2.º reintento, de espera más larga; se busca una cuenta atrás visible (no 0.0 s).
  const visto = await page.getByText(/reintenta en (?:[1-9]|0\.[1-9])/).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (visto) { await page.screenshot({ path: `${OUT}/02-en-vivo.png`, fullPage: true, clip: await clip() }); break; }
  if (intento === 5) throw new Error("no se pudo capturar un evento esperando reintento");
}
await shot("03-detalle-entregado", `${BASE}/#/events/${recoverId}`, () => page.locator("ol.timeline > li").nth(2).waitFor());
await shot("04-eventos", `${BASE}/#/events`, () => page.locator("tbody tr").first().waitFor());
await shot("05-estadisticas", `${BASE}/#/stats`, () => page.locator(".card").first().waitFor());
// Sin token (p. ej. contra la demo pública) se omite la captura como admin. El token nunca se ve: solo «Rol: Admin».
if (ADMIN) await page.evaluate((t) => sessionStorage.setItem("adminToken", t), ADMIN);
if (ADMIN) await shot("06-fallidos-admin", `${BASE}/#/dead`, () => page.getByRole("button", { name: "Reprocesar" }).first().waitFor());
await page.evaluate(() => sessionStorage.removeItem("adminToken"));
await shot("07-fallidos-visitante", `${BASE}/#/dead`, () => page.getByRole("button", { name: "Requiere admin" }).first().waitFor());

// Cómo funciona (C5): el paso 6 bajo el lienzo fijo, que ilumina el arco de reintento.
await page.goto(`${BASE}/#/como-funciona`);
await page.locator(".how-steps li").nth(5).evaluate((el) => {
  const tapado = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"))
    + document.querySelector(".how-visual").getBoundingClientRect().height;
  window.scrollBy(0, el.getBoundingClientRect().top - tapado - 20);
});
await page.locator(".how-steps li").nth(5).and(page.locator('[aria-current="step"]')).waitFor();
await page.waitForTimeout(500);
const fin = await page.locator(".how-steps li").last().evaluate((el) => el.getBoundingClientRect().bottom);
await page.screenshot({ path: `${OUT}/10-como-funciona.png`, clip: { x: 0, y: 0, width: 1440, height: Math.min(900, Math.ceil(fin) + 28) } });

const movil = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await movil.goto(`${BASE}/#/como-funciona`);
await movil.locator(".how-steps li").first().waitFor();
await movil.waitForTimeout(500);
await movil.screenshot({ path: `${OUT}/11-como-funciona-movil.png` });

const sinJs = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, javaScriptEnabled: false })).newPage();
await sinJs.goto(BASE);
const aviso = await sinJs.locator("noscript main").boundingBox();
await sinJs.screenshot({ path: `${OUT}/12-sin-javascript.png`,
  clip: { x: aviso.x - 40, y: aviso.y - 40, width: aviso.width + 80, height: aviso.height + 80 } });

if (TRIAJE_STACK && TRIAJE_URL) {
  const id = await simulate("issue", TRIAJE_STACK);
  await waitFinal(id, TRIAJE_STACK);
  await shot("08-issue-en-integrador", `${TRIAJE_STACK}/#/events/${id}`, async () => {
    await page.getByText("Enviado al destino").click();
    await page.getByText('"subject"').waitFor();
  });
  await shot("09-issue-en-triaje", TRIAJE_URL, () => page.getByText("No puedo entrar a mi cuenta").first().waitFor());
}
} finally {
  await browser.close(); // siempre, aunque falle una captura
}
console.log("capturas en", OUT);

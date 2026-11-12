// Fotogramas del flujo en vivo para el GIF del README: Simular → reintentos → Entregado.
//   OUT=carpeta node scripts/frames.mjs   (contra la demo en marcha en E2E_BASE_URL)
//   uv run --with pillow scripts/gif.py carpeta ../docs/screenshots/demo-flujo.gif
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "frames";
const MS = 100; // un fotograma cada 100 ms: gif.py usa la misma duración
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
let n = 0;
const frame = async () => {
  const t = Date.now();
  await page.screenshot({ path: `${OUT}/${String(n++).padStart(3, "0")}.png` });
  await page.waitForTimeout(Math.max(0, MS - (Date.now() - t)));
};

await page.goto(`${BASE}/#/simulate`);
await page.locator(".node-count").first().waitFor();
const boton = page.getByRole("button", { name: "Falla 2 veces y se recupera" });
for (let i = 0; i < 6; i++) await frame();
await boton.hover();
for (let i = 0; i < 4; i++) await frame();
await boton.click();
const destino = page.locator(".n-d");
for (let i = 0; i < 150; i++) { // hasta que el punto llega al destino
  await frame();
  if ((await destino.getAttribute("class"))?.includes("lit")) break;
}
for (let i = 0; i < 15; i++) await frame(); // pausa final
await browser.close();
console.log(n, "fotogramas en", OUT);

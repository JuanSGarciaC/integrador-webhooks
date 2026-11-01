// Fotogramas del flujo en vivo para el GIF del README: Simular → reintentos → Entregado.
//   OUT=carpeta node scripts/frames.mjs   (contra la demo en marcha en E2E_BASE_URL)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "frames";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, colorScheme: "light" });
let n = 0;
const frame = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, "0")}.png` });

await page.goto(`${BASE}/#/simulate`);
await page.getByRole("heading", { name: "Simular un webhook" }).waitFor();
const boton = page.getByRole("button", { name: "Falla 2 veces y se recupera" });
await frame(); await frame();
await boton.hover(); await frame();
await boton.click();
await page.locator("ol.timeline > li").first().waitFor();
const titulo = page.getByRole("heading", { name: /Evento push/ });
for (let i = 0; i < 40; i++) { // un fotograma cada 250 ms hasta Entregado
  await frame();
  if ((await titulo.textContent())?.includes("Entregado")) break;
  await page.waitForTimeout(250);
}
for (let i = 0; i < 6; i++) await frame(); // pausa final
await browser.close();
console.log(n, "fotogramas en", OUT);

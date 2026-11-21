// Fotogramas a ritmo real para los GIF del README, con el screencast de Chromium (cada fotograma trae su hora).
//   ESCENA=como-funciona OUT=carpeta node scripts/frames.mjs   (contra la demo en marcha en E2E_BASE_URL)
//   python scripts/gif.py carpeta ../docs/screenshots/como-funciona.gif
// Escenas: «como-funciona» (cascada de Simular → scrollytelling → count-up) y «flujo» (un evento que se recupera).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "frames";
const ESCENA = process.env.ESCENA ?? "como-funciona";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  let grabando = false;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    // El screencast solo emite cuando algo cambia; gif.py mantiene el último fotograma en los huecos.
    if (grabando) writeFileSync(`${OUT}/${Math.round(metadata.timestamp * 1000)}.png`, Buffer.from(data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const empieza = async () => {
    grabando = true;
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  };
  const pausa = (ms) => page.waitForTimeout(ms); // grabación a ritmo real: aquí sí se espera tiempo de verdad
  const menu = (nombre) => page.getByRole("navigation").getByRole("link", { name: nombre }).click();

  if (ESCENA === "como-funciona") {
    await page.goto(`${BASE}/#/events`); // se arranca fuera de Simular para grabar la cascada al entrar
    await page.locator("tbody tr").first().waitFor();
    await empieza();
    await pausa(400);
    await menu("Simular");
    await pausa(1600);
    await menu("Cómo funciona");
    await page.locator(".how-steps li").first().waitFor();
    await pausa(1400);
    // Baja paso a paso: cada paso se coloca justo bajo el lienzo fijo con un scroll suave de 700 ms.
    for (let i = 1; i < 8; i++) {
      await page.locator(".how-steps li").nth(i).evaluate((el) => new Promise((ok) => {
        const tapado = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"))
          + document.querySelector(".how-visual").getBoundingClientRect().height;
        const desde = scrollY, hasta = scrollY + el.getBoundingClientRect().top - tapado - 20, t0 = performance.now();
        const paso = (t) => {
          const f = Math.min(1, (t - t0) / 700);
          scrollTo(0, desde + (hasta - desde) * (f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2));
          if (f < 1) requestAnimationFrame(paso); else ok();
        };
        requestAnimationFrame(paso);
      }));
      await pausa(1000);
    }
    await menu("Estadísticas");
    await pausa(2200);
  } else {
    await page.goto(`${BASE}/#/simulate`);
    await page.locator(".node-count").first().waitFor();
    await pausa(1200); // deja terminar la cascada antes de grabar
    await empieza();
    await pausa(700);
    await page.getByRole("button", { name: "Falla 2 veces y se recupera" }).click();
    await page.locator(".n-d.lit").waitFor({ timeout: 30_000 });
    await pausa(1800);
  }
  await cdp.send("Page.stopScreencast");
  grabando = false;
} finally {
  await browser.close(); // siempre, aunque falle la grabación
}
console.log("fotogramas en", OUT);

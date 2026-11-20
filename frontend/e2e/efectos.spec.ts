import { expect, test } from "@playwright/test";

// Efectos del rediseño: se comprueba el resultado (CSS calculado, clases), nunca se espera con temporizadores.

test.describe("A2 · tarjetas de escenarios en cascada", () => {
  test("cada tarjeta empieza un poco después que la anterior", async ({ page }) => {
    await page.goto("/");
    const tarjetas = page.locator(".scenarios > li");
    await expect(tarjetas).toHaveCount(5);
    const retraso = (i: number) => tarjetas.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).animationDelay));
    expect(await retraso(0)).toBe(0);
    expect(await retraso(1)).toBeGreaterThan(await retraso(0));
    expect(await retraso(4)).toBeGreaterThan(await retraso(1));
  });

  test("con movimiento reducido no hay animación y se ven enteras", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const ultima = page.locator(".scenarios > li").nth(4);
    await expect(ultima).toBeVisible();
    expect(await ultima.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await ultima.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});

test.describe("A7 · cifras de Estadísticas que cuentan", () => {
  test.beforeEach(async ({ page }) => {
    // Al menos un evento, para que haya cifras que mostrar.
    const r = await page.request.post("/api/demo/simulate", { data: { scenario: "ok" } });
    expect(r.ok()).toBeTruthy();
  });

  test("arranca en 0 y llega al valor real al avanzar el reloj", async ({ page }) => {
    // Reloj inyectado: el tiempo solo avanza cuando la prueba lo pide.
    await page.clock.install({ time: new Date("2026-01-01T10:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T10:00:01Z"));
    await page.goto("/#/stats");
    const total = page.locator(".cards .card").first();
    const visible = total.locator("strong [aria-hidden]");
    const real = total.locator("strong .sr-only");
    await expect(real).toHaveText(/^[1-9]\d*$/);
    await expect(visible).toHaveText("0");
    await page.clock.runFor(1000);
    await expect(visible).toHaveText((await real.textContent())!);
  });

  test("con movimiento reducido muestra el valor al instante", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date("2026-01-01T10:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T10:00:01Z"));
    await page.goto("/#/stats");
    const total = page.locator(".cards .card").first();
    await expect(total.locator("strong .sr-only")).toHaveText(/^[1-9]\d*$/);
    await expect(total.locator("strong [aria-hidden]")).toHaveText((await total.locator("strong .sr-only").textContent())!);
  });
});

test.describe("C5 · Cómo funciona (scrollytelling con el lienzo)", () => {
  test("se llega desde el menú y todos los pasos se pueden leer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "Cómo funciona" }).click();
    await expect(page.getByRole("heading", { name: "Cómo funciona", level: 2 })).toBeVisible();
    const pasos = page.locator(".how-steps > li");
    await expect(pasos).toHaveCount(8);
    await expect(pasos.first()).toContainText("X-Hub-Signature-256");
    await expect(page.locator(".how-steps")).toContainText("202 Accepted");
  });

  test("al bajar, el paso activo cambia y el lienzo ilumina su tramo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 }); // alto suficiente para el lienzo fijo
    await page.goto("/#/como-funciona");
    expect(await page.locator(".how-visual").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    const pasos = page.locator(".how-steps > li");
    await expect(pasos.first()).toHaveAttribute("aria-current", "step");
    const lienzo = page.getByRole("region", { name: "Recorrido explicado" });
    await expect(lienzo.locator(".n-in")).toHaveClass(/lit/);

    const reintento = pasos.filter({ hasText: "espera exponencial" });
    // Coloca el paso justo bajo el lienzo fijo, donde lo estaría leyendo una persona.
    await reintento.evaluate((el) => {
      // Lo que tapa el lienzo ya pegado: cabecera + alto del lienzo (antes de pegarse está más abajo).
      const cabecera = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
      const tapado = cabecera + document.querySelector(".how-visual")!.getBoundingClientRect().height;
      window.scrollBy(0, el.getBoundingClientRect().top - tapado - 20);
    });
    await expect(reintento).toHaveAttribute("aria-current", "step");
    await expect(pasos.first()).not.toHaveAttribute("aria-current", "step");
    await expect(lienzo.locator(".e-w_q .edge-flow")).toHaveCount(1);
  });

  test("con movimiento reducido ningún paso queda atenuado", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 }); // modo fijo, donde se atenúan los pasos inactivos
    await page.goto("/#/como-funciona");
    const ultimo = page.locator(".how-steps > li").last();
    await expect(ultimo).not.toHaveAttribute("aria-current", "step");
    expect(await ultimo.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("en móvil (390 px) el lienzo no queda fijo", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/como-funciona");
    const visual = page.locator(".how-visual");
    await expect(visual).toBeVisible();
    expect(await visual.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  });
});

test("en móvil (390 px) el menú cabe entero y ninguna entrada se parte", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const enlaces = page.getByRole("navigation").getByRole("link");
  await expect(enlaces).toHaveCount(5);
  for (const caja of await enlaces.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
    expect(caja.right).toBeLessThanOrEqual(390);
    expect(caja.height).toBeLessThan(40); // una sola línea
  }
});

test.describe("sin JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("explica el proyecto y enlaza al README", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Integrador de webhooks" })).toBeVisible();
    // Con cadena, getByText no encontró el texto dentro del <noscript>; con regex sí.
    await expect(page.getByText(/necesita JavaScript/)).toBeVisible();
    await expect(page.getByRole("link", { name: /README/ }))
      .toHaveAttribute("href", "https://github.com/JuanSGarciaC/integrador-webhooks#readme");
  });
});

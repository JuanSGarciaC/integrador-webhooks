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

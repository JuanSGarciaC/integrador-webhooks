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

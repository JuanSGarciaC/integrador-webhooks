import { expect, type Page, test } from "@playwright/test";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
// El estado se lee del badge del título del evento («Entregado» también es una etiqueta del detalle).
const estado = (page: Page) => page.getByRole("heading", { name: /Evento push/ });

test("simular recuperación muestra 3 intentos y Entregado", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Simular un webhook" })).toBeVisible();
  await page.getByRole("button", { name: "Falla 2 veces y se recupera" }).click();

  await expect(estado(page)).toContainText("Entregado", { timeout: 60_000 });
  const intentos = page.locator("ol.timeline > li");
  await expect(intentos).toHaveCount(3);
  await expect(intentos.nth(0)).toContainText("HTTP 503");
  await expect(intentos.nth(2)).toContainText("HTTP 200");
  // El lienzo cuenta lo mismo con palabras y deja encendido el destino.
  const lienzo = page.getByRole("region", { name: "Recorrido de este evento" });
  await expect(lienzo).toContainText("Entregado al intento 3, tras 2 fallo(s).");
  await expect(lienzo.locator(".n-d")).toHaveClass(/lit/);
  // La terminal termina con el mismo resultado que el historial.
  await expect(page.getByRole("group", { name: "Registro del evento" })).toContainText("entregado en el intento 3");
});

test("reprocesar requiere admin y con token entrega el evento", async ({ page }) => {
  test.skip(!ADMIN_TOKEN, "define ADMIN_TOKEN");
  page.on("dialog", (d) => d.accept()); // confirmación de «¿Devolver este evento a la cola?»

  await page.goto("/");
  await page.getByRole("button", { name: "Rechazado (4xx) → fallidos" }).click();
  await expect(estado(page)).toContainText("Fallido", { timeout: 60_000 });
  const eventId = page.url().split("/").pop()!;

  await page.getByRole("navigation").getByRole("link", { name: "Fallidos" }).click(); // el lienzo tiene otro enlace igual
  const fila = page.getByRole("row").filter({ has: page.locator(`a[href="#/events/${eventId}"]`) });
  await expect(fila.getByRole("button", { name: "Requiere admin" })).toBeDisabled();

  await page.getByLabel("Token admin").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Rol: Admin")).toBeVisible();
  await fila.getByRole("button", { name: "Reprocesar" }).click();
  await expect(page.getByText("Evento devuelto a la cola.")).toBeVisible();

  await page.goto(`/#/events/${eventId}`);
  await expect(estado(page)).toContainText("Entregado", { timeout: 60_000 });
  await expect(page.locator("ol.timeline > li")).toHaveCount(2);
});

test("el token no se guarda en localStorage", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Token admin").fill("cualquiera");
  await page.getByRole("button", { name: "Guardar" }).click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("cualquiera");
});

test("el lienzo anima con canvas y con reduced-motion no lo monta", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.locator("canvas.flow-canvas")).toHaveCount(1);

  const quieta = await browser.newPage({ reducedMotion: "reduce" });
  await quieta.goto("/");
  await expect(quieta.getByRole("region", { name: "Recorrido de los eventos" })).toBeVisible();
  await expect(quieta.locator(".n-d")).toBeVisible();
  await expect(quieta.locator("canvas.flow-canvas")).toHaveCount(0);
  await quieta.close();
});

test("el contador de estadísticas termina en el valor real", async ({ page }) => {
  const { total } = await (await page.request.get("/api/stats")).json();
  await page.goto("/#/stats");
  const card = page.locator(".card").filter({ hasText: "Total" });
  await expect(card.locator("strong [aria-hidden]")).toHaveText(String(total));
});

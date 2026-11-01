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
});

test("reprocesar requiere admin y con token entrega el evento", async ({ page }) => {
  test.skip(!ADMIN_TOKEN, "define ADMIN_TOKEN");
  page.on("dialog", (d) => d.accept()); // confirmación de «¿Devolver este evento a la cola?»

  await page.goto("/");
  await page.getByRole("button", { name: "Rechazado (4xx) → fallidos" }).click();
  await expect(estado(page)).toContainText("Fallido", { timeout: 60_000 });
  const eventId = page.url().split("/").pop()!;

  await page.getByRole("link", { name: "Fallidos" }).click();
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

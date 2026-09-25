import { expect, test } from "@playwright/test";

test("switching between standalone and dashboard pages keeps dashboard context", async ({
  page,
}) => {
  await page.route("**/api/tickets", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "backend_unreachable", message: "offline" } }),
    }),
  );

  await page.goto("/usage");
  for (const [destination, heading] of [
    ["Overview", "Overview"],
    ["Usage and cost", "Usage"],
    ["TicketBuddy home", "Attention needed"],
    ["Model playground", "Test the model. See the tradeoffs."],
    ["Overview", "Overview"],
  ]) {
    await page.getByRole("link", { name: destination }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText("Dashboard context missing")).toHaveCount(0);
    await expect(page.getByText("Something went wrong!")).toHaveCount(0);
  }

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("navigation intent preloads tickets and reuses them on return", async ({ page }) => {
  let ticketRequests = 0;
  await page.route("**/api/tickets", (route) => {
    ticketRequests += 1;
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "backend_unreachable", message: "offline" } }),
    });
  });

  await page.goto("/usage");
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  const bundleLoaded = page.waitForResponse((response) =>
    response.url().endsWith("/dashboard-data.json"),
  );
  await page.getByRole("link", { name: "Overview" }).hover();
  await bundleLoaded;
  expect(ticketRequests).toBe(1);

  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Usage and cost" }).click();
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(ticketRequests).toBe(1);
});

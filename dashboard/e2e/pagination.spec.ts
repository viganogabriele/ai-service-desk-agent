import { expect, test } from "@playwright/test";

test("large ticket queues render one page at a time in every view", async ({ page }) => {
  const bundle = await (await page.request.get("/dashboard-data.json")).json();
  const records = Array.from({ length: 2_023 }, (_, index) => ({
    ...bundle.challenge[index % bundle.challenge.length],
    Key: `SUP-${String(index + 1).padStart(3, "0")}`,
    Summary: `Ticket ${index + 1}`,
  }));

  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/tickets")
      return route.fulfill({
        json: {
          records,
          actualIssueCount: records.length,
          jql: "",
          fetchedAtUtc: "2026-09-25T00:00:00Z",
        },
      });

    if (path === "/api/auth/me") return route.fulfill({ json: { enabled: false, user: null } });

    return route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } });
  });

  await page.goto("/tickets?view=table");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await expect(page.getByText("1–50 of 2023 tickets")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("51–100 of 2023 tickets")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "Page 41" }).click();
  await expect(page.getByText("2001–2023 of 2023 tickets")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(23);

  await page.getByRole("searchbox", { name: "Search tickets" }).fill("Ticket 2023");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Ticket pages" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /All tickets/ }).locator("span")).toContainText(
    "1",
  );

  await page.getByRole("searchbox", { name: "Search tickets" }).fill("");
  await page.getByRole("link", { name: "Kanban" }).click();
  await expect(page.getByText("1–50 of 2023 tickets")).toBeVisible();
  await expect(page.locator("[data-board-card]")).toHaveCount(50);

  await page.getByRole("link", { name: "Priority" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await expect(
    page.getByRole("group", { name: "Attention needed" }).locator("article"),
  ).toHaveCount(12);
});

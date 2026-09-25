import { test, expect } from "@playwright/test";

test("API model completes a real shadow evaluation", async ({ page }, testInfo) => {
  test.skip(
    !process.env.E2E_LIVE_MODEL || testInfo.project.name !== "desktop",
    "Set E2E_LIVE_MODEL and E2E_LIVE_PROVIDER (openai, swisscom, or ollama); requires the backend and Core with reviewed tickets.",
  );
  test.setTimeout(30 * 60 * 1000);
  await page.goto("/playground");
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption(process.env.E2E_LIVE_PROVIDER || "openai");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill(process.env.E2E_LIVE_MODEL!);
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByRole("heading", { name: "Disagreement explorer" })).toBeVisible({
    timeout: 29 * 60 * 1000,
  });
  await expect(
    page.getByText("No tickets in this set. Review tickets first, or choose recent tickets."),
  ).toHaveCount(0);
  await expect(page.getByText("0 / 0 labelled decisions")).toHaveCount(0);
  await expect(page.getByText(/0 failed ·/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  await (await download).saveAs(testInfo.outputPath("live-evaluation.json"));
});

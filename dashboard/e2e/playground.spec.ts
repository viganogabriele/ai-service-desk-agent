import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Evaluation } from "../src/lib/evaluations";

function evaluation(id = "e_test", model = "qwen2.5:7b"): Evaluation {
  return {
    evaluation_id: id,
    status: "completed",
    created_at: "2026-09-25T10:00:00Z",
    completed_at: "2026-09-25T10:00:10Z",
    ticket_ids: ["ticket-a", "ticket-b"],
    request: { ticket_set: "gold" },
    results: {
      versions: { model, prompt: "v1", kb: "v1", policy: "p1" },
      summary: { tickets: 2, failed: 0, changed_decisions: 2 },
      per_field: {
        service: { n: 2, n_labelled: 2, agree_label: 1, agreement_label: 0.5, agreement_live: 0.5 },
        work_type: { n: 2, n_labelled: 2, agree_label: 2, agreement_label: 1, agreement_live: 0.5 },
      },
      disagreements: [
        {
          ticket_id: "ticket-a",
          field: "service",
          shadow: "Cash Management",
          live: "Tax Reporting",
          label: "Tax Reporting",
        },
        {
          ticket_id: "ticket-b",
          field: "work_type",
          shadow: "Incident",
          live: "Service Request",
          label: "Incident",
        },
      ],
      shadow_run_ids: ["run-a", "run-b"],
    },
  };
}

async function mockGateway(page: Page, result = evaluation(), pending = false) {
  const submissions: { versions: { model: string }; ticket_set: string; days: number }[] = [];
  const reads = new Map<string, number>();
  const writes: string[] = [];
  await page.route("**/core/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (request.method() === "POST") {
      writes.push(path);
      if (path !== "/core/evaluations") return route.fulfill({ status: 400 });
      submissions.push(request.postDataJSON());
      return route.fulfill({
        json: { evaluation_id: `e_test_${submissions.length}`, tickets: result.ticket_ids.length },
      });
    }
    if (path.includes("/evaluations/")) {
      const id = path.split("/").at(-1)!;
      const count = reads.get(id) ?? 0;
      reads.set(id, count + 1);
      const index = Number(id.split("_").at(-1)) - 1;
      const payload = structuredClone(result);
      payload.evaluation_id = id;
      if (payload.results)
        payload.results.versions.model = submissions[index]?.versions.model ?? "qwen2.5:7b";
      if (pending && count === 0) {
        payload.status = "queued";
        payload.results = null;
      }
      return route.fulfill({ json: payload });
    }
    if (path.includes("/runs/"))
      return route.fulfill({
        json: {
          ticket_id: path.endsWith("run-a") ? "ticket-a" : "ticket-b",
          status: "completed",
          started_at: "2026-09-25T10:00:00Z",
          completed_at: path.endsWith("run-a") ? "2026-09-25T10:00:02Z" : "2026-09-25T10:00:08Z",
          error: null,
        },
      });
    return route.fulfill({ json: { tickets: [] } });
  });
  return { submissions, writes };
}

test.beforeEach(async ({ page }) => {
  // Isolate the operator dashboard's background queries from any locally running Jira gateway.
  await page.route("**/tickets", (route) => route.abort("connectionrefused"));
});

test("saved evidence is measured, labelled, inspectable and exportable", async ({ page }) => {
  await page.goto("/playground");
  await expect(
    page.getByRole("heading", { name: "Test the model. See the tradeoffs." }),
  ).toBeVisible();
  await expect(page.getByText("12 / 12 labelled decisions")).toBeVisible();
  await expect(page.getByText("4.74s", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Assignee: unlabelled" })).toBeVisible();
  await page
    .getByText("Execution desk cannot submit trades after FIX session disconnect", { exact: true })
    .last()
    .click();
  await expect(page.getByText("Reference: Trading Platform")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("saved-dev-baseline.json");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const artifact = JSON.parse(Buffer.concat(chunks).toString());
  expect(artifact.source).toBe("saved artifact");
  expect(artifact.cases).toHaveLength(6);
  expect(artifact.results.per_field.service.agree_label).toBe(6);
});

test("two-model comparison polls to completion, filters mistakes and survives reload", async ({
  page,
}) => {
  const { submissions, writes } = await mockGateway(page, evaluation(), true);
  await page.goto("/playground");
  await page.getByLabel("Compare with").fill("swiss-ai/Apertus-v1.5-70B");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByRole("heading", { name: "Disagreement explorer" })).toBeVisible();
  expect(submissions.map((entry) => entry.versions.model)).toEqual([
    "openai/gpt-6-luna",
    "swisscom/swiss-ai/Apertus-v1.5-70B",
  ]);
  expect(submissions.every((entry) => entry.ticket_set === "gold")).toBe(true);
  expect(writes).toEqual(["/core/evaluations", "/core/evaluations"]);
  await expect(page.getByText("5.00s", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("8.00s", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("3 / 4 labelled decisions")).toBeVisible();
  await page.getByLabel("Filter by field").selectOption("service");
  await expect(page.getByRole("cell", { name: "Mismatch", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Match", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "swisscom/swiss-ai/Apertus-v1.5-70B gold" }).click();
  await expect(page.getByText("3 / 4 labelled decisions")).toBeVisible();
  expect(submissions).toHaveLength(2);
});

test("unlabelled predictions and failed tickets never turn into perfect accuracy", async ({
  page,
}) => {
  const result = evaluation();
  result.results!.summary.failed = 1;
  result.results!.per_field = {
    service: { n: 1, n_labelled: 0, agree_label: 0, agreement_label: null, agreement_live: 1 },
  };
  result.results!.disagreements = [
    {
      ticket_id: "ticket-a",
      field: "service",
      shadow: "Cash Management",
      live: "Tax Reporting",
      label: null,
    },
  ];
  await mockGateway(page, result);
  await page.goto("/playground");
  await page.getByLabel("Ticket set").selectOption("recent");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText("0 / 0 labelled decisions")).toBeVisible();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Unscored", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Service: unlabelled", exact: true })).toBeVisible();
});

test("empty ticket sets explain how to get useful results", async ({ page }) => {
  const result = evaluation();
  result.ticket_ids = [];
  result.results!.summary = { tickets: 0, failed: 0, changed_decisions: 0 };
  result.results!.per_field = {};
  result.results!.disagreements = [];
  result.results!.shadow_run_ids = [];
  await mockGateway(page, result);
  await page.goto("/playground");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(
    page.getByText("No tickets in this set. Review tickets first, or choose recent tickets."),
  ).toBeVisible();
  await expect(page.getByText("0 / 0 labelled decisions")).toBeVisible();
});

test("a gateway failure is actionable and a new attempt can succeed", async ({ page }) => {
  let offline = true;
  await mockGateway(page);
  await page.route("**/core/evaluations", async (route) => {
    if (offline)
      return route.fulfill({
        status: 503,
        json: { message: "Core is not configured. Start the local Core and retry." },
      });
    await route.fallback();
  });
  await page.goto("/playground");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByRole("alert")).toContainText("Core is not configured");
  await expect(page.getByText("12 / 12 labelled decisions")).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText("3 / 4 labelled decisions")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("navigation, keyboard focus and both themes work without page overflow", async ({ page }) => {
  await page.goto("/overview");
  await page.getByRole("link", { name: "Model playground" }).click();
  await expect(page).toHaveURL(/\/playground$/);
  await expect(page.getByText("12 / 12 labelled decisions")).toBeVisible();
  const input = page.getByRole("textbox", { name: "Model", exact: true });
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Comparison provider", exact: true }),
  ).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await expect(page.getByRole("button", { name: "Run evaluation" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("playground-light.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: test.info().outputPath("playground-dark.png"), fullPage: true });
});

test("saved baseline failures recover without a ticket service", async ({ page }) => {
  let unavailable = true;
  await page.route("**/playground-baseline.json", (route) =>
    unavailable ? route.fulfill({ status: 503 }) : route.continue(),
  );
  await page.goto("/playground");
  await expect(page.getByRole("alert")).toContainText("Saved baseline could not be loaded", {
    timeout: 15_000,
  });
  unavailable = false;
  await page.getByRole("button", { name: "Retry loading run" }).click();
  await expect(page.getByText("12 / 12 labelled decisions")).toBeVisible();
});

test("failed and missing timings are excluded from latency metrics", async ({ page }) => {
  const result = evaluation();
  result.results!.summary.failed = 1;
  await mockGateway(page, result);
  await page.route("**/core/runs/run-b", (route) =>
    route.fulfill({
      json: {
        ticket_id: "ticket-b",
        status: "failed",
        started_at: "2026-09-25T10:00:00Z",
        completed_at: null,
        error: "Model not available on the local Ollama server",
      },
    }),
  );
  await page.goto("/playground");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText("Model not available on the local Ollama server")).toBeVisible();
  const meanCard = page
    .locator("section")
    .filter({ has: page.getByText("Mean ticket time", { exact: true }) });
  await expect(meanCard.getByText("2.00s", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
});

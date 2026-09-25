import { expect, test } from "@playwright/test";

test("ticket queue fits the viewport and classification can be approved inline", async ({
  page,
}) => {
  await page.route("**/api/tickets", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "backend_unreachable", message: "offline" } }),
    }),
  );

  await page.goto("/tickets");
  await expect(page.getByRole("heading", { name: /Attention needed/i })).toBeVisible();

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth,
  );

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Skip to content");

  await page.getByRole("link", { name: "Review classification" }).first().click();
  await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth,
  );

  const classification = page.getByRole("complementary", { name: "Classification" });
  const nextStep = page.locator('[aria-label="Next step"]').first();

  if (viewportWidth < 1100) {
    expect((await classification.boundingBox())!.y).toBeLessThan((await nextStep.boundingBox())!.y);
  }

  const approve = page.getByRole("button", { name: /Approve suggested Work type/i });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Undo approval for Work type/i })).toBeFocused();
});

test("Core evidence and approvals survive a reload", async ({ page }) => {
  const bundle = await (await page.request.get("/dashboard-data.json")).json();
  const ticket = { ...bundle.challenge[0], Key: "SUP-TEST" };
  const quote = ticket.Description.slice(0, 12);
  const decision = (value: string) => ({
    effective_value: value,
    source: "ai_judgment",
    confidence: 0.72,
    confidence_signals: { retrieval_similarity: 0.81 },
    reason: "The ticket describes this service.",
    rule_trace: null,
    evidence: {
      ticket_spans: [{ field: "Description", start: 0, end: quote.length, text: quote }],
      patterns: [
        { pattern_id: "P1", similarity: 0.82, service: "Trading Platform", resolver: "a@b.com" },
      ],
      service_card: "Trading Platform",
    },
    alternatives: [],
    flags: ["service_changed"],
    pinned: false,
  });
  const history: { type: string; run_id: string; fields: string[] }[] = [];
  let accepted: string[] = [];
  let jiraPatch: Record<string, unknown> | null = null;
  const coreView = {
    ticket_id: "c-1",
    external_key: "SUP-TEST",
    lane: "needs_review",
    lane_reasons: ["service_changed"],
    latest_run: { run_id: "run-1", versions: { model: "demo-core" }, audit_sampled: false },
    effective_state: {
      work_type: decision("Incident"),
      service: decision("Trading Platform"),
      team: decision("Investment Operations"),
      assignee: decision("a@b.com"),
      urgency: decision("High"),
      impact: decision("High"),
      priority: decision("High"),
      resolution: decision("done"),
    },
    resolution_comment: {
      text: "a@b.com: Resolution: Service restored.",
      stale: false,
      segments: [{ text: "Resolution: Service restored.", origin: "generated" }],
      exemplar_pattern_ids: ["P1"],
      unsupported_specifics: ["Service restored"],
    },
    history,
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/tickets") {
      if (route.request().method() === "POST") {
        jiraPatch = route.request().postDataJSON()[0];
        ticket.Status = "done";
        ticket.Resolution = "clarification";
        ticket["All Comments"].push(...((jiraPatch?.["All Comments"] as string[]) ?? []));
        await route.fulfill({ json: { results: [{ key: "SUP-TEST", ok: true, warnings: [] }] } });
      } else {
        await route.fulfill({
          json: {
            records: [ticket],
            actualIssueCount: 1,
            jql: "",
            fetchedAtUtc: "2026-09-25T00:00:00Z",
          },
        });
      }
    } else if (path === "/api/core/tickets") {
      await route.fulfill({
        json: {
          tickets: [
            {
              ticket_id: "c-1",
              external_key: "SUP-TEST",
              lane: "needs_review",
              risk: 1.2,
              run_status: "completed",
              ...(url.searchParams.get("expand") === "view" ? { view: coreView } : {}),
            },
          ],
        },
      });
    } else if (path === "/api/core/tickets/c-1") {
      await route.fulfill({ json: coreView });
    } else if (path === "/api/core/tickets/c-1/accept") {
      accepted = route.request().postDataJSON().fields;
      history.push({ type: "acceptance", run_id: "run-1", fields: accepted });
      await route.fulfill({ json: { acceptance_id: "a-1" } });
    } else if (path === "/api/core/tickets/c-1/overrides") {
      await route.fulfill({ json: { overrides: [] } });
    } else if (path === "/api/auth/me") {
      await route.fulfill({ json: { enabled: false, user: null } });
    } else {
      await route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } });
    }
  });

  await page.goto("/tickets/SUP-TEST");
  await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Core evidence & risk" }).click();
  await expect(page.getByText("Risk score: 1.20")).toBeVisible();
  await expect(
    page.getByText("Historical ticket pattern P1", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.locator("mark").first()).toContainText(quote);

  await page.getByRole("button", { name: /Approve suggested Work type/i }).click();
  await expect.poll(() => accepted).toEqual(["work_type"]);
  await page.reload();
  await expect(page.getByRole("button", { name: /Approve suggested Work type/i })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Work type: Incident, Confirmed by you/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Ask the reporter/i }).click();
  await page.getByRole("textbox", { name: "Question" }).fill("Which environment is affected?");
  await page.getByRole("button", { name: "Send question and close" }).click();
  await expect.poll(() => jiraPatch?.Resolution).toBe("clarification");
  await expect
    .poll(() => jiraPatch?.["All Comments"])
    .toEqual(["a@b.com: Which environment is affected?"]);
  await expect(page.getByText("Closed · clarification").first()).toBeVisible();
});

test("an unreachable backend explains the failure and recovers on retry", async ({ page }) => {
  const unreachable = JSON.stringify({
    error: { code: "backend_unreachable", message: "offline" },
  });

  await page.route("**/api/tickets", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: unreachable }),
  );
  await page.route("**/dashboard-data.json", (route) => route.fulfill({ status: 404, body: "" }));

  await page.goto("/tickets");
  await expect(
    page.getByRole("heading", { name: "Can’t reach the TicketBuddy backend" }),
  ).toBeVisible();
  // The top bar stays, so the operator can still switch views and themes.
  await expect(page.getByRole("navigation", { name: "Ticket views" })).toBeVisible();

  await page.unroute("**/dashboard-data.json");
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByRole("heading", { name: /Attention needed/i })).toBeVisible();
});

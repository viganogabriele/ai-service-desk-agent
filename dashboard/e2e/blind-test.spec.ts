import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BlindTest, ChallengeFile, Pipeline } from "../src/lib/blind-test";

const BLIND_FILE = fileURLToPath(
  new URL(
    "../../core/jira_hackathon_blind_eval_challenge_20260923083915-1141.json",
    import.meta.url,
  ),
);

const input: ChallengeFile = JSON.parse(readFileSync(BLIND_FILE, "utf8"));

function pipeline(key: Pipeline["key"], model: string, done: number): Pipeline {
  const total = input.records.length;
  const finished = done >= total;
  const tickets = input.records.map((record, index) => ({
    key: `R${String(index + 1).padStart(2, "0")}`,
    summary: record.Summary,
    status: index < done ? "completed" : index < done + 2 ? "running" : "queued",
    seconds: index < done ? 20 + index : null,
    latency_ms: index < done ? 18_000 : 0,
    error: null,
  })) satisfies Pipeline["tickets"];

  return {
    key,
    model,
    status: finished ? "completed" : "running",
    started_at: "2026-09-25T10:00:00+00:00",
    completed_at: finished ? "2026-09-25T10:03:07+00:00" : null,
    seconds: finished ? 187.2 : null,
    tickets,
    progress: {
      total,
      queued: tickets.filter((ticket) => ticket.status === "queued").length,
      running: tickets.filter((ticket) => ticket.status === "running").length,
      completed: done,
      failed: 0,
    },
    usage: {
      cost: 0.0123 * done,
      saved: 0,
      calls: 2 * done,
      cache_hits: 0,
      retries: 0,
      errors: 0,
      input_tokens: 5000 * done,
      cached_input_tokens: 0,
      output_tokens: 800 * done,
      reasoning_tokens: 0,
      tokens: 5800 * done,
      latency_ms: 18_000 * done,
      currency: "USD",
    },
    versions: { model, prompt: "p1", kb: "v1", policy: "p1" },
    output: finished
      ? {
          ...input,
          records: input.records.map((record) => ({
            ...record,
            "Affected Business or IT Services": ["Tax Reporting"],
            "Service Team(s)": ["Tax & Reporting"],
            Assignee: "tania.gupta@intcom.com",
            Status: "done",
            Resolution: "done",
            "All Comments": [
              ...record["All Comments"],
              "tania.gupta@intcom.com: Resolution: Licence assigned and confirmed.",
            ],
          })),
        }
      : null,
    error: null,
  };
}

/** The Core behind the gateway: the run completes on the third poll. */
async function mockGateway(page: Page, reference = true) {
  let polls = 0;
  const posts: { input: ChallengeFile; source: string }[] = [];
  await page.route("**/api/core/blind-tests**", (route) => {
    const request = route.request();

    if (request.method() === "POST") {
      posts.push(request.postDataJSON());

      return route.fulfill({
        status: 202,
        json: { blind_test_id: "bt_test", status: "queued", tickets: 20 },
      });
    }

    polls += 1;
    const done = polls >= 3 ? 20 : polls * 7;
    const pipelines = [pipeline("submission", "openai/gpt-6-luna", done)];

    if (reference) pipelines.push(pipeline("reference", "swisscom/swiss-ai/Apertus-v1.5-70B", done));

    const body: BlindTest = {
      blind_test_id: "bt_test",
      created_at: "2026-09-25T10:00:00+00:00",
      source: posts[0]?.source ?? "blind.json",
      status: done >= 20 ? "completed" : "running",
      tickets: 20,
      input,
      pipelines,
      skipped: reference
        ? []
        : [{ key: "reference", model: "swisscom/swiss-ai/Apertus-v1.5-70B", reason: "no key" }],
    };

    return route.fulfill({ json: body });
  });

  return posts;
}

test("a dropped file is checked, run, shown with progress, and downloaded", async ({ page }) => {
  const posts = await mockGateway(page);
  await page.goto("/blind-test");
  await expect(page.getByRole("heading", { name: "Blind test pipeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run pipeline" })).toBeDisabled();

  await page.getByLabel("Choose the blind test JSON").setInputFiles(BLIND_FILE);
  await expect(page.getByText("20 tickets")).toBeVisible();
  await expect(page.getByLabel("Input file")).toContainText('"records"');

  await page.getByRole("button", { name: "Run pipeline" }).click();
  expect(posts).toHaveLength(1);
  expect(posts[0].source).toMatch(/\.json$/);
  expect(posts[0].input.records).toHaveLength(20);

  const progress = page.getByRole("status");
  await expect(progress).toContainText("/ 20");
  await expect(progress).toContainText("working");
  await expect(page.getByLabel("Submission output")).toContainText("Resolution: Licence assigned", {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Output Submission" })).toBeVisible();
  await expect(page.getByText("gpt-6-luna")).toBeVisible();
  await expect(page.getByText("3 m 07 s")).toBeVisible();
  await expect(page.getByText("USD 0.25")).toBeVisible();
  await expect(page.getByText("116K")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/_solution\.json$/);

  await page.getByRole("group", { name: "Pipeline" }).getByRole("button", { name: "Reference" }).click();
  await expect(page.getByRole("heading", { name: "Output Reference only" })).toBeVisible();
  await expect(page.getByText("Apertus-v1.5-70B")).toBeVisible();
  await expect(page.getByLabel("Reference output")).toBeVisible();
});

test("a file the pipeline cannot fill is refused before anything is sent", async ({ page }) => {
  const posts = await mockGateway(page);
  await page.goto("/blind-test");
  await page.getByLabel("Choose the blind test JSON").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"records": [{"Summary": "no other fields"}]}'),
  });
  await expect(page.getByRole("alert")).toContainText("records[0].Work type");
  await expect(page.getByRole("button", { name: "Run pipeline" })).toBeDisabled();
  expect(posts).toHaveLength(0);
});

test("without a reference model there is one output and no switch", async ({ page }) => {
  await mockGateway(page, false);
  await page.goto("/blind-test");
  await page.getByLabel("Choose the blind test JSON").setInputFiles(BLIND_FILE);
  await page.getByRole("button", { name: "Run pipeline" }).click();
  await expect(page.getByLabel("Submission output")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("group", { name: "Pipeline" })).toHaveCount(0);
});

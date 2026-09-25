import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PURPOSE_LABELS,
  bucketLabel,
  compact,
  formatMetric,
  labelOf,
  money,
  rankBy,
} from "../src/lib/usage.ts";
import type { UsageTotals } from "../src/lib/usage.ts";

function totals(cost: number, tokens: number, calls: number): UsageTotals {
  return {
    cost,
    saved: 0,
    calls,
    cache_hits: 0,
    retries: 0,
    errors: 0,
    input_tokens: tokens,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    tokens,
    share: null,
  };
}

test("money keeps small call costs readable", () => {
  assert.equal(money(0), "USD 0.00");
  assert.equal(money(0.0042), "USD 0.0042");
  assert.equal(money(1204.5), "USD 1,204.50");
});

test("token counts are compact, like the provider consoles", () => {
  assert.equal(compact(2060), "2.06K");
  assert.equal(compact(167_000_000), "167M");
  assert.equal(formatMetric(1234, "calls"), "1,234");
});

test("rankBy orders by the chosen measure and shares add up", () => {
  const rows = [totals(1, 900, 3), totals(3, 100, 1)];
  const byCost = rankBy(rows, "cost");
  const byTokens = rankBy(rows, "tokens");

  assert.deepEqual(
    byCost.map((item) => item.share),
    [0.75, 0.25],
  );
  assert.equal(byTokens[0].row.tokens, 900);
  assert.deepEqual(rankBy([totals(0, 0, 0)], "cost")[0].share, 0);
});

test("bucket labels follow the bucket size", () => {
  assert.match(bucketLabel("2026-09-25", "day"), /^25 Sept?$/);
  assert.equal(bucketLabel("2026-09-25T14", "hour"), "14:00");
});

test("unknown Core keys are shown as they are", () => {
  assert.equal(labelOf(PURPOSE_LABELS, "triage"), "Live classification");
  assert.equal(labelOf(PURPOSE_LABELS, "backfill"), "backfill");
});

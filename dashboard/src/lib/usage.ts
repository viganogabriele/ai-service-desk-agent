/** GET /usage of the Core (CORE_API §9, LLM usage), through the backend's /core proxy. */

export const WINDOWS = [
  { value: "24h", label: "Past 24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

export type UsageWindow = (typeof WINDOWS)[number]["value"];

export const METRICS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "calls", label: "Calls" },
] as const;

export type UsageMetric = (typeof METRICS)[number]["value"];

export interface UsageTotals {
  cost: number;
  saved: number;
  calls: number;
  cache_hits: number;
  retries: number;
  errors: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  tokens: number;
  share: number | null;
}

export interface UsageRow extends UsageTotals {
  key: string;
}

export interface Price {
  input: number;
  cached_input: number;
  output: number;
}

export interface ModelRow extends UsageRow {
  provider: string;
  model: string;
  priced: boolean;
  price: Price | null;
}

export interface SeriesPoint extends UsageTotals {
  start: string;
}

export interface Usage {
  window: UsageWindow;
  bucket: "hour" | "day";
  from: string;
  to: string;
  currency: string;
  totals: UsageTotals & {
    uncached_input_tokens: number;
    saved_prompt_cache: number;
    saved_response_cache: number;
    retry_cost: number;
    triage_runs: number;
    cost_per_triage_run: number | null;
    latency_ms_mean: number | null;
  };
  series: SeriesPoint[];
  breakdown: {
    model: ModelRow[];
    provider: UsageRow[];
    stage: UsageRow[];
    purpose: UsageRow[];
  };
}

export async function fetchUsage(base: string, window: UsageWindow, signal?: AbortSignal) {
  const response = await fetch(`${base}/core/usage?window=${window}`, {
    signal,
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        `The Core did not answer (${response.status}). Check that the backend and Core are running.`,
    );
  }

  const usage: Usage = await response.json();

  return usage;
}

// Keys come from the Core, which may add new ones; an unknown key is shown as it is.
export const PROVIDER_LABELS = new Map([
  ["ollama", "Ollama · Mac mini"],
  ["openai", "OpenAI"],
  ["swisscom", "Swisscom Apertus"],
]);

export const STAGE_LABELS = new Map([
  ["decision", "Triage decision"],
  ["self_consistency", "Self-consistency samples"],
  ["evidence", "Evidence quotes"],
  ["resolution_note", "Resolution note"],
  ["demo_ticket", "Simulated ticket"],
  ["service_card", "Service card draft"],
]);

export const PURPOSE_LABELS = new Map([
  ["triage", "Live classification"],
  ["comment", "Note regeneration"],
  ["evaluation", "Playground evaluations"],
  ["demo", "Simulated tickets"],
  ["kb_build", "Knowledge-base build"],
  ["other", "Other"],
]);

export function labelOf(labels: Map<string, string>, key: string) {
  return labels.get(key) ?? key;
}

/** The value a metric reads from a row. Tokens are what the model processed: input and output. */
export function metricValue(row: UsageTotals, metric: UsageMetric) {
  if (metric === "cost") return row.cost;

  if (metric === "tokens") return row.tokens;

  return row.calls;
}

/** Rows ordered by the chosen metric, each with its share of that metric. */
export function rankBy<T extends UsageTotals>(rows: T[], metric: UsageMetric) {
  const total = rows.reduce((sum, row) => sum + metricValue(row, metric), 0);

  return rows
    .map((row) => ({ row, share: total ? metricValue(row, metric) / total : 0 }))
    .sort((a, b) => metricValue(b.row, metric) - metricValue(a.row, metric));
}

/** Money with enough decimals to tell small calls apart: CHF 0.0042, CHF 3.10, CHF 1,204.50. */
export function money(value: number, currency = "CHF") {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;

  return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});

/** Token counts the way the provider consoles show them: 2.06K, 1.03M, 167M. */
export function compact(value: number) {
  return compactFormat.format(value);
}

export function formatMetric(value: number, metric: UsageMetric, currency = "CHF") {
  if (metric === "cost") return money(value, currency);

  return metric === "tokens" ? compact(value) : value.toLocaleString("en-US");
}

/** "25 Sep" for a day bucket, "14:00" for an hour bucket (UTC, like the Core). */
export function bucketLabel(start: string, bucket: Usage["bucket"]) {
  if (bucket === "hour") return `${start.slice(11, 13)}:00`;

  return new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

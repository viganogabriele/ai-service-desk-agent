import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AreaChart } from "../components/charts";
import { Bone } from "../components/skeleton";
import { Badge, Dot } from "../components/ui/badge";
import type { Tone } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle, Empty } from "../components/ui/card";
import { SectionHead } from "../components/ui/section";
import {
  METRICS,
  PROVIDER_LABELS,
  PURPOSE_LABELS,
  STAGE_LABELS,
  WINDOWS,
  bucketLabel,
  compact,
  fetchUsage,
  formatMetric,
  labelOf,
  metricValue,
  money,
  rankBy,
} from "../lib/usage";
import type { ModelRow, Usage, UsageMetric, UsageTotals, UsageWindow } from "../lib/usage";
import { cn } from "../lib/utils";

const BREAKDOWNS = [
  { value: "model", label: "Model" },
  { value: "stage", label: "Pipeline step" },
  { value: "purpose", label: "Purpose" },
  { value: "day", label: "Day" },
] as const;

type Breakdown = (typeof BREAKDOWNS)[number]["value"];

interface UsageSearch {
  window?: UsageWindow;
  metric?: UsageMetric;
  by?: Breakdown;
}

export const Route = createFileRoute("/usage")({
  component: UsagePage,
  validateSearch: (search: { window?: string; metric?: string; by?: string }): UsageSearch => {
    const window = WINDOWS.find((item) => item.value === search.window)?.value;
    const metric = METRICS.find((item) => item.value === search.metric)?.value;
    const by = BREAKDOWNS.find((item) => item.value === search.by)?.value;

    const valid: UsageSearch = {};

    if (window) valid.window = window;

    if (metric) valid.metric = metric;

    if (by) valid.by = by;

    return valid;
  },
});

// The same backend as the rest of the dashboard: the dev proxy at /api unless overridden.
const base = (import.meta.env.VITE_BACKEND_URL || "/api").replace(/\/+$/, "");

const REFRESH_MS = 30_000;

const row = "grid grid-cols-12 gap-card-gap";

const divided = "border-t border-divider first:border-t-0";

// Providers keep their colour however the list is sorted.
const PROVIDER_TONES = new Map<string, Tone>([
  ["openai", "primary"],
  ["swisscom", "danger"],
  ["ollama", "success"],
]);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const plural = (count: number, word: string) =>
  `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

function UsagePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/usage" });
  const span = search.window ?? "30d";
  const metric = search.metric ?? "cost";
  const by = search.by ?? "model";

  const query = useQuery({
    queryKey: ["usage", base, span],
    queryFn: ({ signal }) => fetchUsage(base, span, signal),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });

  const set = (next: UsageSearch) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  return (
    <div className="mb-card-gap flex flex-col">
      <SectionHead className="mb-6">
        <h1 className="font-display text-3xl leading-title font-semibold tracking-snug text-primary-text">
          Usage
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
          <Segmented
            label="Measure"
            options={METRICS}
            value={metric}
            onChange={(value) => set({ metric: value })}
          />
          <Segmented
            label="Time range"
            options={WINDOWS}
            value={span}
            onChange={(value) => set({ window: value })}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh"
            data-tip="Refresh"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw
              size={16}
              strokeWidth={1.75}
              className={cn(query.isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </SectionHead>

      {query.data ? (
        <UsageReport
          usage={query.data}
          metric={metric}
          by={by}
          onBreakdown={(value) => set({ by: value })}
        />
      ) : query.isError ? (
        <Unavailable message={query.error.message} onRetry={() => query.refetch()} />
      ) : (
        <UsageSkeleton />
      )}
    </div>
  );
}

/** A row of toggle buttons for one choice, in the pill track of the view switch. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-pill border bg-surface p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className="h-8 rounded-pill px-3.5 font-display text-sm font-semibold whitespace-nowrap text-nav transition-colors duration-150 ease-soft hover:text-secondary aria-pressed:bg-thumb aria-pressed:text-primary-text aria-pressed:inset-ring aria-pressed:inset-ring-primary/55 max-sm:px-2.5"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const HEADLINE_LABELS: Record<UsageMetric, string> = {
  cost: "Estimated cost",
  tokens: "Processed tokens",
  calls: "Model calls",
};

function UsageReport({
  usage,
  metric,
  by,
  onBreakdown,
}: {
  usage: Usage;
  metric: UsageMetric;
  by: Breakdown;
  onBreakdown: (value: Breakdown) => void;
}) {
  const { totals, currency } = usage;
  const format = (value: number) => formatMetric(value, metric, currency);
  const range = WINDOWS.find((item) => item.value === usage.window)?.label.toLowerCase();
  const per = usage.bucket === "hour" ? "Hourly" : "Daily";

  const headlineMeta = {
    cost: `${plural(totals.calls, "call")} · ${plural(totals.triage_runs, "classification")} · list-price estimate`,
    tokens: `${compact(totals.input_tokens)} in · ${compact(totals.output_tokens)} out`,
    calls: `${plural(totals.cache_hits, "answer")} from the cache · ${plural(totals.retries, "retry")}`,
  }[metric];

  const points = usage.series.map((point) => ({
    label: bucketLabel(point.start, usage.bucket),
    value: metricValue(point, metric),
    note:
      metric === "calls"
        ? `${compact(point.tokens)} tokens`
        : `${plural(point.calls, "call")}${point.cache_hits ? ` · ${point.cache_hits} cached` : ""}`,
  }));

  return (
    <div className="flex flex-col gap-card-gap">
      <Card className="grid grid-cols-12 gap-card-gap max-lg:gap-y-8">
        <div className="col-span-4 flex flex-col max-lg:col-span-12">
          <span className="text-sm font-medium text-secondary">{HEADLINE_LABELS[metric]}</span>
          <strong className="mt-2 font-display text-5xl leading-kpi font-semibold tracking-tight tabular-nums max-sm:text-4xl">
            {format(metricValue(totals, metric))}
          </strong>
          <small className="mt-1 text-sm text-muted tabular-nums">{headlineMeta}</small>
          <ProviderList rows={usage.breakdown.provider} metric={metric} currency={currency} />
        </div>
        <div className="col-span-8 max-lg:col-span-12">
          <CardHeader className="mb-3">
            <div>
              <CardTitle>
                {per} {METRICS.find((item) => item.value === metric)?.label.toLowerCase()}
              </CardTitle>
              <CardDescription>
                {range} · UTC · refreshed{" "}
                {new Date(usage.to).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </CardDescription>
            </div>
          </CardHeader>
          <AreaChart points={points} format={format} label={`${per} ${metric}, ${range}`} />
        </div>
      </Card>

      <div className={row}>
        <Card className="col-span-8 max-lg:col-span-12">
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-6 max-sm:grid-cols-2">
            <Figure label="Processed tokens" value={compact(totals.tokens)} />
            <Figure label="Cached input" value={compact(totals.cached_input_tokens)} />
            <Figure label="Uncached input" value={compact(totals.uncached_input_tokens)} />
            <Figure
              label="Output"
              value={compact(totals.output_tokens)}
              note={
                totals.reasoning_tokens
                  ? `${compact(totals.reasoning_tokens)} of it reasoning`
                  : undefined
              }
            />
            <Figure
              label="Cache savings"
              value={money(totals.saved, currency)}
              note={`${money(totals.saved_response_cache, currency)} from repeated answers`}
            />
            <Figure
              label="Per classification"
              value={
                totals.cost_per_triage_run === null
                  ? "—"
                  : money(totals.cost_per_triage_run, currency)
              }
              note="decision, samples, evidence and note"
            />
          </dl>
        </Card>
        <Card className="col-span-4 max-lg:col-span-12">
          <CardHeader>
            <div>
              <CardTitle>Call outcomes</CardTitle>
              <CardDescription>
                Cached answers are free; retries and failures cost time
              </CardDescription>
            </div>
          </CardHeader>
          <dl className="grid">
            <Fact label="Answered from the cache">
              {totals.cache_hits.toLocaleString("en-US")}
              <Share part={totals.cache_hits} whole={totals.calls + totals.cache_hits} />
            </Fact>
            <Fact label="Retried after invalid output">
              {totals.retries.toLocaleString("en-US")}
              {totals.retry_cost > 0 && (
                <small className={factNote}>{money(totals.retry_cost, currency)}</small>
              )}
            </Fact>
            <Fact label="Failed without an answer">{totals.errors.toLocaleString("en-US")}</Fact>
            <Fact label="Mean response time">
              {totals.latency_ms_mean === null
                ? "—"
                : `${(totals.latency_ms_mean / 1000).toFixed(1)} s`}
            </Fact>
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-wrap">
          <CardTitle>Breakdown</CardTitle>
          <Segmented label="Break down by" options={BREAKDOWNS} value={by} onChange={onBreakdown} />
        </CardHeader>
        {totals.calls + totals.cache_hits === 0 ? (
          <Empty>
            No model calls in the {range === "past 24h" ? "past 24 hours" : `last ${range}`}.
            Classify a ticket or simulate an incoming one, and its calls show up here.
          </Empty>
        ) : (
          <BreakdownTable usage={usage} metric={metric} by={by} />
        )}
      </Card>

      <PriceNote models={usage.breakdown.model} currency={currency} />
    </div>
  );
}

function ProviderList({
  rows,
  metric,
  currency,
}: {
  rows: Usage["breakdown"]["provider"];
  metric: UsageMetric;
  currency: string;
}) {
  if (!rows.length) return null;

  return (
    <ul className="mt-auto grid gap-4 pt-8">
      {rankBy(rows, metric).map(({ row: provider, share }) => (
        <li key={provider.key} className="grid gap-0.5">
          <span className="flex items-baseline gap-2">
            <Dot
              tone={PROVIDER_TONES.get(provider.key) ?? "muted"}
              className="size-2 self-center"
            />
            <b className="font-display text-lg font-semibold">
              {labelOf(PROVIDER_LABELS, provider.key)}
            </b>
            <small className="text-sm text-muted">{plural(provider.calls, "call")}</small>
            <b className="ml-auto text-md font-semibold tabular-nums">
              {formatMetric(metricValue(provider, metric), metric, currency)}
            </b>
          </span>
          <span className="pl-4 text-sm text-muted tabular-nums">
            {pct(share)} of {metric} · {compact(provider.tokens)} tokens
          </span>
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="mt-0.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}

const factNote = "ml-1.5 font-sans text-sm font-normal text-muted";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2.5", divided)}>
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="text-right font-display text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  return whole ? <small className={factNote}>{pct(part / whole)}</small> : null;
}

const TH =
  "h-10 px-3 text-left text-xs font-semibold tracking-caps whitespace-nowrap text-muted uppercase first:pl-0 last:pr-0";

const TD = "h-13 px-3 tabular-nums first:pl-0 last:pr-0";

interface TableRow {
  key: string;
  name: ReactNode;
  detail?: ReactNode;
  totals: UsageTotals;
}

function tableRows(usage: Usage, by: Breakdown): TableRow[] {
  if (by === "model")
    return usage.breakdown.model.map((model) => ({
      key: model.key,
      name: (
        <>
          {model.model}
          {!model.priced && <Badge className="ml-2">No price set</Badge>}
        </>
      ),
      detail: labelOf(PROVIDER_LABELS, model.provider),
      totals: model,
    }));

  if (by === "day")
    return usage.series
      .flatMap((point) =>
        point.calls + point.cache_hits > 0
          ? [{ key: point.start, name: bucketLabel(point.start, usage.bucket), totals: point }]
          : [],
      )
      .reverse();

  const labels = by === "stage" ? STAGE_LABELS : PURPOSE_LABELS;

  return usage.breakdown[by].map((item) => ({
    key: item.key,
    name: labelOf(labels, item.key),
    totals: item,
  }));
}

function BreakdownTable({
  usage,
  metric,
  by,
}: {
  usage: Usage;
  metric: UsageMetric;
  by: Breakdown;
}) {
  const rows = tableRows(usage, by);
  const total = rows.reduce((sum, item) => sum + metricValue(item.totals, metric), 0);

  // Days stay in date order; every other breakdown ranks by the chosen measure.
  const ordered =
    by === "day"
      ? rows
      : [...rows].sort((a, b) => metricValue(b.totals, metric) - metricValue(a.totals, metric));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="border-b border-divider">
            <th className={TH}>{BREAKDOWNS.find((item) => item.value === by)?.label}</th>
            <th className={cn(TH, "text-right max-sm:hidden")}>Calls</th>
            <th className={cn(TH, "text-right")}>Cost</th>
            <th className={cn(TH, "w-1/4 max-md:hidden")}>
              Share of {metric === "calls" ? "calls" : metric}
            </th>
            <th className={cn(TH, "text-right max-sm:hidden")}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((item) => {
            const share = total ? metricValue(item.totals, metric) / total : 0;

            return (
              <tr key={item.key} className="border-b border-divider last:border-b-0">
                <td className={TD}>
                  <span className="flex flex-col">
                    <span className="flex items-center font-medium">{item.name}</span>
                    {item.detail && <small className="text-sm text-muted">{item.detail}</small>}
                  </span>
                </td>
                <td className={cn(TD, "text-right text-secondary max-sm:hidden")}>
                  {item.totals.calls.toLocaleString("en-US")}
                  {item.totals.cache_hits > 0 && (
                    <small className="ml-1 text-sm text-muted">
                      +{item.totals.cache_hits} cached
                    </small>
                  )}
                </td>
                <td className={cn(TD, "text-right font-medium")}>
                  {money(item.totals.cost, usage.currency)}
                </td>
                <td className={cn(TD, "max-md:hidden")}>
                  <span className="flex items-center gap-3">
                    <span className="flex h-1.5 flex-1 rounded-pill bg-elevated">
                      <span
                        className="h-full min-w-0.5 rounded-pill bg-primary"
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                    <span className="w-12 text-right text-sm text-secondary">{pct(share)}</span>
                  </span>
                </td>
                <td className={cn(TD, "text-right text-secondary max-sm:hidden")}>
                  {compact(item.totals.tokens)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const perMillion = (value: number, currency: string) => `${currency} ${value.toFixed(2)}`;

/** Where the numbers come from, so nobody mistakes the estimate for an invoice. */
function PriceNote({ models, currency }: { models: ModelRow[]; currency: string }) {
  const priced = models.filter((model) => model.price && model.price.output > 0);

  return (
    <p className="max-w-prose text-sm leading-relaxed text-muted">
      Costs are estimates from the Core’s price list (<code>LLM_PRICES</code>, {currency} per
      million tokens), fixed when each call is made.{" "}
      {priced.map((model) => (
        <span key={model.key}>
          {model.model}: {perMillion(model.price?.input ?? 0, currency)} in,{" "}
          {perMillion(model.price?.cached_input ?? 0, currency)} cached,{" "}
          {perMillion(model.price?.output ?? 0, currency)} out.{" "}
        </span>
      ))}
      Calls to the self-hosted Ollama cost nothing per token. Evaluations and simulated tickets
      count here too; command-line runs do not.
    </p>
  );
}

/** The Core did not answer: say which part to start, and try again. */
function Unavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="grid max-w-150 gap-3" role="alert">
      <CardTitle className="text-lg">Usage comes from the Core, and it didn’t answer</CardTitle>
      <p className="text-md leading-relaxed text-secondary">
        “{message.replace(/\.$/, "")}.” Start the backend with <code>CORE_BASE_URL</code> set and
        the Core with <code>uvicorn api.main:app</code>; this page checks again every 30 seconds.
      </p>
      <Button className="justify-self-start" onClick={onRetry}>
        <RefreshCw size={14} strokeWidth={1.75} />
        Try again
      </Button>
    </Card>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex animate-skeleton-in flex-col gap-card-gap" role="status" aria-busy="true">
      <span className="sr-only">Loading usage…</span>
      <Card className="grid h-78 grid-cols-12 gap-card-gap" aria-hidden="true">
        <div className="col-span-4 flex flex-col gap-3 max-lg:col-span-12">
          <Bone className="w-24" />
          <Bone className="h-9 w-44" />
          <Bone className="w-56" />
        </div>
        <Bone className="col-span-8 h-full rounded-tile max-lg:hidden" />
      </Card>
      <div className={row} aria-hidden="true">
        <Card className="col-span-8 h-48 max-lg:col-span-12" />
        <Card className="col-span-4 h-48 max-lg:col-span-12" />
      </div>
    </div>
  );
}

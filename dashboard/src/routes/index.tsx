import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, CalendarDays, Info } from "lucide-react";
import { useDashboard } from "../state";
import { SERVICES } from "../domain";
import {
  BarList,
  BarListItem,
  BarListRoot,
  BoxKey,
  ColumnChart,
  ForecastChart,
  LegendInline,
  LegendItem,
  LineKey,
  StackedBar,
} from "../components/charts";
import { buttonVariants } from "../components/ui/button";
import { Dot, MockBadge, Pill, Tag } from "../components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ChangeArrow, OldValue } from "../components/ui/change";
import { Field, InputGroup, InputGroupInput } from "../components/ui/field";
import { Grid, SPAN, Stack } from "../components/ui/grid";
import {
  Eyebrow,
  PageDescription,
  PageHeader,
  PageTitle,
  SectionTitle,
} from "../components/ui/page";
import { CellNote, Table, TableCell, TableHead, TableScroll } from "../components/ui/table";
import { cn } from "../lib/utils";
import {
  economics,
  hourlyProfile,
  queuePrediction,
  reviewStats,
  weeklyForecast,
} from "../insights";
import type { EconomicsInput } from "../insights";
import type { ComponentProps, ReactNode } from "react";

export const Route = createFileRoute("/")({ component: Insights });

const HORIZON_WEEKS = 8;

const FIELD_LABELS = new Map([
  ["work_type", "Work type"],
  ["service", "Service"],
  ["assignee", "Assignee"],
  ["urgency", "Urgency"],
  ["impact", "Impact"],
  ["resolution", "Resolution"],
]);

const fmt = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const pct = (value: number, digits = 0) => `${fmt(value * 100, digits)}%`;

const chf = (value: number) => `CHF ${fmt(value, Math.abs(value) < 10 ? 2 : 0)}`;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const kpiLabel = "flex items-center gap-2 text-sm font-medium text-secondary";

const kpiMeta = "text-sm text-muted tabular-nums";

function Kpi({ label, value, meta }: { label: ReactNode; value: ReactNode; meta: ReactNode }) {
  return (
    <Card className={cn("flex flex-col gap-1", SPAN[3])}>
      <span className={kpiLabel}>{label}</span>
      <strong className="mt-3 text-5xl leading-kpi font-semibold tracking-tighter tabular-nums">
        {value}
      </strong>
      <small className={kpiMeta}>{meta}</small>
    </Card>
  );
}

/** Takeaway sentence under a chart. */
function Insight({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex gap-2 border-t border-divider pt-3 text-sm leading-relaxed text-secondary">
      <Info size={14} strokeWidth={1.75} className="mt-0.5 text-muted" />
      <span>{children}</span>
    </p>
  );
}

function Facts({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <dl className={cn("group/facts grid", compact && "mt-4")} data-compact={compact || undefined}>
      {children}
    </dl>
  );
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-divider py-2.5 first:border-t-0">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="text-right text-xl font-semibold tracking-snug group-data-compact/facts:text-base">
        {value}
        {note && <small className="block text-xs font-normal text-muted">{note}</small>}
      </dd>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  tag,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  tag: "Assumption" | "From data" | "Measured";
  step?: number;
  suffix?: string;
}) {
  return (
    <Field>
      <span className="flex items-center justify-between gap-2">
        {label}
        <Tag tone={tag === "Assumption" ? "warning" : "default"}>{tag}</Tag>
      </span>
      <InputGroup>
        <InputGroupInput
          className="tabular-nums"
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value)))}
        />
        {suffix && <span className="text-sm whitespace-nowrap text-muted">{suffix}</span>}
      </InputGroup>
    </Field>
  );
}

function Insights() {
  const { data, review, actions, history, premium } = useDashboard();
  const h = data.historical;
  const done = h.status.done ?? 0;
  const resolvedDone = h.resolution.done ?? 0;
  const daily = h.total / h.days;
  const forecast = weeklyForecast(h.weekly, HORIZON_WEEKS);
  const profile = hourlyProfile(h.heatmap);
  const local = data.models.find((model) => model.kind === "local") ?? data.models[0];

  const regenerated = data.challenge.filter((_, index) => history(index).length > 0).length;
  const stats = reviewStats(data, review, actions, regenerated);
  const queue = queuePrediction(data, review);

  const [assumptions, setAssumptions] = useState<EconomicsInput>(() => ({
    volumePerDay: Math.round(daily),
    manualMinutes: 8,
    reviewMinutes: 2,
    reviewShare: 1,
    hourlyCost: 90,
    baseCost: local?.cost_chf_per_ticket ?? 0,
    premiumShare: 0.1,
    premiumCost: 0.03,
    latencySeconds: (local?.latency_ms_mean ?? local?.latency_ms_p50 ?? 0) / 1000,
  }));

  const set = (changed: Partial<EconomicsInput>) =>
    setAssumptions((current) => ({ ...current, ...changed }));

  const scenarios = [1, 10].map((multiplier) => economics(assumptions, multiplier));
  const next30 = (forecast.nextWeeks / (HORIZON_WEEKS * 7)) * 30;
  const workers = Math.ceil(scenarios[1].computeHoursDay / 24);

  const services = SERVICES.map(([name, , rating]) => ({
    label: name,
    value: h.service[name] ?? 0,
    highlight: rating === "Critical",
  })).sort((a, b) => b.value - a.value);

  const sortedRows = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

  const outcomeRows = [
    { label: "Accepted unchanged", value: stats.accepted },
    { label: "Modified & accepted", value: stats.modified },
    { label: "Escalated", value: stats.escalated },
    { label: "Clarification", value: stats.clarification },
    { label: "Open", value: stats.open },
  ];

  const hourLabels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

  return (
    <>
      <PageHeader>
        <div>
          <Eyebrow>Operations · Insights</Eyebrow>
          <PageTitle>Service desk insights</PageTitle>
          <PageDescription>
            Demand, routing quality, AI review outcomes and the cost of triage.
          </PageDescription>
        </div>
        <Pill>
          <CalendarDays size={14} strokeWidth={1.75} />
          {dayLabel(h.first_day)} – {dayLabel(h.last_day)} 2026 · {h.days} days
        </Pill>
      </PageHeader>

      <Grid as="section" aria-label="Headline KPIs">
        <Kpi
          label="Historical tickets"
          value={fmt(h.total)}
          meta={`${fmt(daily, 1)} per day · ${fmt(h.status["in progress"] ?? 0)} in progress · ${fmt(
            h.status.open ?? 0,
          )} open`}
        />
        <Kpi
          label="“Done” actually resolved"
          value={pct(resolvedDone / done, 1)}
          meta={`${fmt(resolvedDone)} of ${fmt(done)} done carry Resolution “done”`}
        />
        <Kpi
          label="Generic service bucket"
          value={pct(h.generic_bucket / h.total, 1)}
          meta={`${fmt(h.generic_bucket)} tickets need routing to a real service`}
        />
        <Kpi
          label={
            <>
              <Dot tone="primary" />
              Challenge queue reviewed
            </>
          }
          value={`${stats.total - stats.open} / ${stats.total}`}
          meta={`${stats.resolved} resolved · ${stats.escalated} escalated · ${stats.clarification} clarification`}
        />
      </Grid>

      <SectionTitle>Demand & forecast</SectionTitle>
      <Grid>
        <Card className={SPAN[8]}>
          <CardHeader>
            <div>
              <CardTitle>Weekly intake</CardTitle>
              <CardDescription>
                {h.weekly.length} complete weeks · linear trend with an {HORIZON_WEEKS}-week
                projection
              </CardDescription>
            </div>
            <LegendInline>
              <LegendItem>
                <LineKey variant="primary" />
                Actual
              </LegendItem>
              <LegendItem>
                <LineKey variant="trend" />
                Trend
              </LegendItem>
              <LegendItem>
                <LineKey variant="dashed" />
                Projection · 95% band
              </LegendItem>
            </LegendInline>
          </CardHeader>
          <ForecastChart points={forecast.points} />
        </Card>
        <Card className={SPAN[4]}>
          <CardHeader>
            <div>
              <CardTitle>Projection</CardTitle>
              <CardDescription>Statistical extrapolation, not a capacity test.</CardDescription>
            </div>
          </CardHeader>
          <Facts>
            <Fact
              label={`Next ${HORIZON_WEEKS} weeks`}
              value={fmt(forecast.nextWeeks)}
              note={`± ${fmt(forecast.nextWeeksBand)}`}
            />
            <Fact label="Next 30 days" value={fmt(next30)} />
            <Fact
              label="Trend"
              value={
                Math.abs(forecast.slope) < 0.5
                  ? "Flat"
                  : `${forecast.slope > 0 ? "+" : ""}${fmt(forecast.slope, 1)}`
              }
              note={`${fmt(forecast.slope, 2)} tickets / week per week`}
            />
            <Fact
              label="L2 review load, 30 days"
              value={`${fmt((next30 * assumptions.reviewShare * assumptions.reviewMinutes) / 60)} h`}
              note={`at ${assumptions.reviewMinutes} min / ticket`}
            />
          </Facts>
          <Insight>
            Weekly volume moves only ±{pct((1.96 * forecast.sigma) / forecast.meanWeekly)} around{" "}
            {fmt(forecast.meanWeekly)}: demand is steady, so throughput sizing matters more than
            peak handling.
          </Insight>
        </Card>
      </Grid>
      <Grid>
        <Card className={SPAN[6]}>
          <CardHeader>
            <div>
              <CardTitle>Intake by hour of day</CardTitle>
              <CardDescription>All weekdays combined · line marks the hourly mean</CardDescription>
            </div>
            <b className="text-md font-semibold tabular-nums">+{pct(profile.peakLift, 1)} peak</b>
          </CardHeader>
          <ColumnChart values={profile.hours} labels={hourLabels} label="Tickets by hour of day" />
          <Insight>
            Busiest hour {hourLabels[profile.peakHour]} is only {pct(profile.peakLift, 1)} above the
            mean and weekdays differ by {pct(profile.weekdaySpread, 1)}: tickets arrive around the
            clock, which favours automated first-pass triage.
          </Insight>
        </Card>
        <Card className={SPAN[6]}>
          <CardHeader>
            <div>
              <CardTitle>How “done” tickets ended</CardTitle>
              <CardDescription>
                Status “done” includes outcomes other than resolved.
              </CardDescription>
            </div>
            <b className="text-md font-semibold tabular-nums">{fmt(done)}</b>
          </CardHeader>
          <StackedBar
            total={done}
            rows={Object.entries(h.resolution)
              .map(([label, value]) => ({ label, value }))
              .sort((a, b) => Number(b.label === "done") - Number(a.label === "done"))}
          />
          <Insight>
            {pct(1 - resolvedDone / done)} of closed tickets were cancelled, not reproducible or
            waiting on clarification: a clear request up front avoids most of that rework.
          </Insight>
        </Card>
      </Grid>

      <SectionTitle>Routing</SectionTitle>
      <Grid>
        <Card className={SPAN[7]}>
          <CardHeader>
            <div>
              <CardTitle>Tickets by affected service</CardTitle>
              <CardDescription>Historical file · {SERVICES.length} services</CardDescription>
            </div>
            <LegendInline>
              <LegendItem>
                <BoxKey accent />
                Critical
              </LegendItem>
              <LegendItem>
                <BoxKey />
                Non-Critical
              </LegendItem>
            </LegendInline>
          </CardHeader>
          <BarList rows={services} total={h.total} />
        </Card>
        <Stack className={SPAN[5]}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tickets by team</CardTitle>
                <CardDescription>Derived 1:1 from the service</CardDescription>
              </div>
            </CardHeader>
            <BarList rows={sortedRows(h.team)} total={h.total} />
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tickets by business entity</CardTitle>
              </div>
            </CardHeader>
            <BarList rows={sortedRows(h.entity)} total={h.total} />
          </Card>
        </Stack>
      </Grid>

      <SectionTitle>
        AI triage performance {data.mock && <MockBadge size="mini">Mock proposals</MockBadge>}
      </SectionTitle>
      <Grid>
        <Card className={SPAN[12]}>
          <CardHeader>
            <div>
              <CardTitle>Review outcomes · challenge queue</CardTitle>
              <CardDescription>
                From the operator action log · {stats.regenerated} ticket
                {stats.regenerated === 1 ? "" : "s"} regenerated with a stronger model
              </CardDescription>
            </div>
            <div className="grid justify-items-end gap-2">
              <b className="text-2xl leading-none font-semibold tabular-nums">
                {stats.resolved ? pct(stats.accepted / stats.resolved) : "—"}
              </b>
              <small className="text-xs text-muted">accepted without edits</small>
            </div>
          </CardHeader>
          <StackedBar total={stats.total} rows={outcomeRows} />
        </Card>
      </Grid>
      <Grid>
        <Card className={SPAN[4]}>
          <CardHeader>
            <div>
              <CardTitle>Proposal kept, by field</CardTitle>
              <CardDescription>
                Share of resolved tickets where the operator kept the AI value
              </CardDescription>
            </div>
          </CardHeader>
          {stats.resolved === 0 ? (
            <EmptyReview />
          ) : (
            <BarListRoot>
              {stats.fieldAgreement.map((row) => (
                <BarListItem
                  key={row.field}
                  label={FIELD_LABELS.get(row.field) ?? row.field}
                  width={pct(row.rate ?? 0)}
                  accent
                  value={row.rate === null ? "—" : pct(row.rate)}
                />
              ))}
              <CardDescription>
                Resolution comment edited on {pct(stats.commentEdited ?? 0)} of resolved tickets.
              </CardDescription>
            </BarListRoot>
          )}
        </Card>
        <Card className={SPAN[4]}>
          <CardHeader>
            <div>
              <CardTitle>Most frequent corrections</CardTitle>
              <CardDescription>Where operators overrode the proposal</CardDescription>
            </div>
          </CardHeader>
          {stats.corrections.length === 0 ? (
            stats.resolved === 0 ? (
              <EmptyReview />
            ) : (
              <p className="text-muted">No field corrections among resolved tickets.</p>
            )
          ) : (
            <ol className="grid">
              {stats.corrections.map((item) => (
                <li
                  key={`${item.field}-${item.proposed}-${item.final}`}
                  className="grid grid-cols-correction gap-2 border-t border-divider py-2.5 text-sm first:border-t-0"
                >
                  <span className="text-muted">{FIELD_LABELS.get(item.field) ?? item.field}</span>
                  <span>
                    <OldValue>{item.proposed || "—"}</OldValue>
                    <ChangeArrow />
                    {item.final || "—"}
                  </span>
                  <b className="tabular-nums">×{item.count}</b>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card className={SPAN[4]}>
          <CardHeader>
            <div>
              <CardTitle>Incoming queue prediction</CardTitle>
              <CardDescription>Priority mix of the current proposals</CardDescription>
            </div>
          </CardHeader>
          <BarList
            rows={queue.levels.map((row) => ({
              label: row.level,
              value: row.count,
              highlight: row.level === "Highest" || row.level === "High",
            }))}
          />
          <Facts compact>
            <Fact label="Critical services" value={`${queue.critical} / ${stats.total}`} />
            <Fact label="Service re-routed" value={queue.serviceChanged} />
            <Fact
              label="Mean service confidence"
              value={queue.meanConfidence === null ? "Not measured" : pct(queue.meanConfidence)}
            />
          </Facts>
        </Card>
      </Grid>

      <SectionTitle>Models & cost</SectionTitle>
      <Grid>
        <Card className={cn(SPAN[12], "pb-4 sm:pb-4")}>
          <CardHeader>
            <div>
              <CardTitle>Model comparison</CardTitle>
              <CardDescription>
                {data.models_source === "dev_run"
                  ? "Measured on the saved local development run (output/dev_predictions.json)."
                  : data.models_source === "file"
                    ? "Read from dashboard/data/models.json."
                    : "No model metrics available."}
              </CardDescription>
            </div>
          </CardHeader>
          <TableScroll>
            <Table className="min-w-180">
              <thead>
                <tr>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Latency p50</TableHead>
                  <TableHead className="text-right">Latency p95</TableHead>
                  <TableHead className="text-right">Cost / ticket</TableHead>
                  <TableHead className="text-right">Service acc.</TableHead>
                  <TableHead className="text-right">Work type acc.</TableHead>
                  <TableHead>Evaluation set</TableHead>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.model_id} className="hover:bg-white/2">
                    <ModelCell>
                      <span className="text-foreground">{model.label}</span>
                      <CellNote>{model.model_id}</CellNote>
                    </ModelCell>
                    <ModelCell>{model.kind}</ModelCell>
                    <ModelCell numeric>
                      {model.latency_ms_p50 == null
                        ? "Not measured"
                        : `${fmt(model.latency_ms_p50 / 1000, 2)} s`}
                    </ModelCell>
                    <ModelCell numeric>
                      {model.latency_ms_p95 == null
                        ? "Not measured"
                        : `${fmt(model.latency_ms_p95 / 1000, 2)} s`}
                    </ModelCell>
                    <ModelCell numeric title={model.cost_note}>
                      {model.cost_chf_per_ticket == null
                        ? "Not measured"
                        : chf(model.cost_chf_per_ticket)}
                    </ModelCell>
                    <ModelCell numeric>
                      {model.holdout?.accuracy.service == null
                        ? "Not measured"
                        : pct(model.holdout.accuracy.service)}
                    </ModelCell>
                    <ModelCell numeric>
                      {model.holdout?.accuracy.work_type == null
                        ? "Not measured"
                        : pct(model.holdout.accuracy.work_type)}
                    </ModelCell>
                    <ModelCell>
                      {model.holdout
                        ? `n = ${model.holdout.n} · ${model.holdout.label ?? "hold-out"}`
                        : "—"}
                    </ModelCell>
                  </tr>
                ))}
                {premium.url && !data.models.some((model) => model.kind === "premium") && (
                  <tr className="hover:bg-white/2">
                    <ModelCell>
                      <span className="text-foreground">Premium solver</span>
                      <CellNote>{premium.model ?? premium.url}</CellNote>
                    </ModelCell>
                    <ModelCell>premium</ModelCell>
                    <ModelCell className="text-right">Not measured</ModelCell>
                    <ModelCell className="text-right">Not measured</ModelCell>
                    <ModelCell className="text-right">Not measured</ModelCell>
                    <ModelCell className="text-right">Not measured</ModelCell>
                    <ModelCell className="text-right">Not measured</ModelCell>
                    <ModelCell>{premium.online ? "Online" : "Offline"}</ModelCell>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableScroll>
          <CardDescription className="mt-3">
            Accuracy is measured on labelled data only. Assignee, Priority and Resolution text are
            not evaluated for lack of ground truth; {data.models[0]?.holdout?.n ?? 0} labelled cases
            are not a benchmark.
          </CardDescription>
        </Card>
      </Grid>
      <Grid>
        <Card className={SPAN[12]}>
          <CardHeader>
            <div>
              <CardTitle>Unit economics</CardTitle>
              <CardDescription>
                Assisted triage vs fully manual triage. Every input is editable.
              </CardDescription>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-7 xl:grid-cols-economics">
            <div className="grid grid-cols-1 content-start gap-x-4 gap-y-3.5 sm:grid-cols-2">
              <NumberInput
                label="Ticket volume"
                suffix="/ day"
                tag="From data"
                value={assumptions.volumePerDay}
                onChange={(value) => set({ volumePerDay: value })}
              />
              <NumberInput
                label="Manual triage time"
                suffix="min"
                tag="Assumption"
                step={0.5}
                value={assumptions.manualMinutes}
                onChange={(value) => set({ manualMinutes: value })}
              />
              <NumberInput
                label="Assisted review time"
                suffix="min"
                tag="Assumption"
                step={0.5}
                value={assumptions.reviewMinutes}
                onChange={(value) => set({ reviewMinutes: value })}
              />
              <NumberInput
                label="Reviewed by L2"
                suffix="%"
                tag="Assumption"
                step={5}
                value={Math.round(assumptions.reviewShare * 100)}
                onChange={(value) => set({ reviewShare: Math.min(100, value) / 100 })}
              />
              <NumberInput
                label="L2 hourly cost"
                suffix="CHF"
                tag="Assumption"
                step={5}
                value={assumptions.hourlyCost}
                onChange={(value) => set({ hourlyCost: value })}
              />
              <NumberInput
                label="Local model cost"
                suffix="CHF / ticket"
                tag={local?.cost_chf_per_ticket == null ? "Assumption" : "Measured"}
                step={0.001}
                value={assumptions.baseCost}
                onChange={(value) => set({ baseCost: value })}
              />
              <NumberInput
                label="Sent to premium"
                suffix="%"
                tag="Assumption"
                step={5}
                value={Math.round(assumptions.premiumShare * 100)}
                onChange={(value) => set({ premiumShare: Math.min(100, value) / 100 })}
              />
              <NumberInput
                label="Premium model cost"
                suffix="CHF / call"
                tag="Assumption"
                step={0.005}
                value={assumptions.premiumCost}
                onChange={(value) => set({ premiumCost: value })}
              />
              <NumberInput
                label="Model latency"
                suffix="s / ticket"
                tag={local?.latency_ms_mean ? "Measured" : "Assumption"}
                step={0.1}
                value={Number(assumptions.latencySeconds.toFixed(2))}
                onChange={(value) => set({ latencySeconds: value })}
              />
            </div>
            <div>
              <div className="mb-4 grid gap-1">
                <span className={kpiLabel}>Estimated yearly saving at today's volume</span>
                <strong
                  className={cn(
                    "text-6xl leading-display font-semibold tracking-tightest sm:text-7xl",
                    scenarios[0].savingYear < 0 && "text-danger",
                  )}
                >
                  {chf(scenarios[0].savingYear)}
                </strong>
                <small className={kpiMeta}>
                  {fmt(scenarios[0].hoursSavedDay, 1)} L2 hours freed per day · model spend{" "}
                  {chf(scenarios[0].modelDay * 365)} / year
                </small>
              </div>
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <TableHead className={scenarioEdge}>Per day</TableHead>
                    <TableHead className={cn(scenarioEdge, "text-right")}>1× volume</TableHead>
                    <TableHead className={cn(scenarioEdge, "text-right")}>10× volume</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Tickets", (row) => fmt(row.volume)],
                      ["Model cost", (row) => chf(row.modelDay)],
                      ["Assisted total (model + review)", (row) => chf(row.assistedDay)],
                      ["Manual triage", (row) => chf(row.manualDay)],
                      ["Saving", (row) => chf(row.savingDay)],
                      ["L2 hours freed", (row) => fmt(row.hoursSavedDay, 1)],
                      ["Serial compute hours", (row) => fmt(row.computeHoursDay, 1)],
                      ["Cost per ticket", (row) => chf(row.totalPerTicket)],
                    ] satisfies [string, (row: (typeof scenarios)[number]) => string][]
                  ).map(([label, value]) => (
                    <tr key={label} className="hover:bg-white/2">
                      <TableCell className={cn(scenarioEdge, "h-9")}>{label}</TableCell>
                      <TableCell className={cn(scenarioEdge, "h-9 text-right tabular-nums")}>
                        {value(scenarios[0])}
                      </TableCell>
                      <TableCell className={cn(scenarioEdge, "h-9 text-right tabular-nums")}>
                        {value(scenarios[1])}
                      </TableCell>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Insight>
                At 10× volume one serial worker needs {fmt(scenarios[1].computeHoursDay, 1)} compute
                hours a day
                {workers > 1 ? `, so at least ${workers} parallel workers` : ", within one worker"}.
                Throughput scaling is untested.
              </Insight>
            </div>
          </div>
        </Card>
      </Grid>
    </>
  );
}

/** Scenario table sits inside the card padding, so its edge cells drop the bleed padding. */
const scenarioEdge = "first:pl-0 last:pr-0 sm:first:pl-0 sm:last:pr-0";

function ModelCell({
  numeric = false,
  className,
  ...props
}: ComponentProps<typeof TableCell> & { numeric?: boolean }) {
  return (
    <TableCell className={cn("h-11", numeric && "text-right tabular-nums", className)} {...props} />
  );
}

function EmptyReview() {
  return (
    <div className="grid justify-items-start gap-3 text-muted">
      <p>No resolved tickets yet.</p>
      <Link to="/tickets" className={buttonVariants()}>
        Open the ticket workspace
        <ArrowRight size={16} strokeWidth={1.75} />
      </Link>
    </div>
  );
}

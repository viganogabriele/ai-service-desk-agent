import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useDashboard } from "../state";
import { FIELD_LABELS, SERVICES, STATUS_DOTS, STATUS_LABELS, fieldLabel } from "../domain";
import {
  Bar,
  BarList,
  Bars,
  ForecastChart,
  Key,
  KeyBox,
  Legend,
  LegendItem,
} from "../components/charts";
import { Dot } from "../components/ui/badge";
import { buttonVariants } from "../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { SectionCount, SectionHead, SectionText, SectionTitle } from "../components/ui/section";
import { aiStats, queueStats, ticketOutcomes, weeklyForecast } from "../insights";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/overview")({ component: Overview });

const HORIZON_WEEKS = 8;

const fmt = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const pct = (value: number, digits = 0) => `${fmt(value * 100, digits)}%`;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** A row of the 12-column card grid. Cards span 3 to 8 columns and go full width below 1100px. */
const row = "grid grid-cols-12 gap-card-gap";

const span = {
  3: "col-span-3 max-lg:col-span-6",
  4: "col-span-4 max-lg:col-span-12",
  5: "col-span-5 max-lg:col-span-12",
  6: "col-span-6 max-lg:col-span-12",
  7: "col-span-7 max-lg:col-span-12",
  8: "col-span-8 max-lg:col-span-12",
};

const cardValue = "text-md font-semibold tabular-nums";

const divided = "border-t border-divider first:border-t-0";

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <Card className={cn("flex flex-col gap-1", span[3])}>
      <span className="text-sm font-medium text-secondary">{label}</span>
      <strong className="mt-3 font-display text-5xl leading-kpi font-semibold tracking-tight tabular-nums max-sm:text-4xl">
        {value}
      </strong>
      <small className="text-sm text-muted tabular-nums">{meta}</small>
    </Card>
  );
}

function InlineFact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold">{children}</dd>
    </div>
  );
}

const factNote = "font-sans text-sm font-normal text-muted";

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2.5", divided)}>
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="text-right font-display text-xl font-semibold">{children}</dd>
    </div>
  );
}

function Overview() {
  const { data, review, actions, proposalFor } = useDashboard();
  const h = data.historical;
  const done = h.status.done ?? 0;
  const resolved = h.resolution.done ?? 0;
  const backlog = (h.status.open ?? 0) + (h.status["in progress"] ?? 0);
  const forecast = weeklyForecast(h.weekly, HORIZON_WEEKS);
  const queue = queueStats(data, review);

  const ai = aiStats(
    data,
    data.challenge.map((_, index) => proposalFor(index)),
    actions,
    review,
  );

  const services = SERVICES.map(([name, , rating]) => ({
    label: name,
    value: h.service[name] ?? 0,
    highlight: rating === "Critical",
  })).sort((a, b) => b.value - a.value);

  const teams = Object.entries(h.team)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="mb-card-gap flex flex-col gap-section">
      <div>
        <SectionHead>
          <h1 className="inline-flex items-center gap-2.5 font-display text-3xl leading-title font-semibold tracking-snug text-primary-text">
            Overview
          </h1>
          <SectionText>
            {fmt(h.total)} Jira service desk tickets created {dayLabel(h.first_day)} –{" "}
            {dayLabel(h.last_day)}
          </SectionText>
        </SectionHead>

        <div className="flex flex-col gap-card-gap">
          <section className={row} aria-label="Key figures">
            <Stat
              label="Tickets per day"
              value={fmt(h.total / h.days, 1)}
              meta={`${fmt(h.total)} tickets over ${h.days} days`}
            />
            <Stat
              label="Open backlog"
              value={fmt(backlog)}
              meta={`${fmt(h.status.open ?? 0)} open · ${fmt(h.status["in progress"] ?? 0)} in progress`}
            />
            <Stat
              label="Closed tickets actually resolved"
              value={pct(resolved / done, 1)}
              meta={`${fmt(resolved)} of ${fmt(done)} closed tickets`}
            />
            <Stat
              label="Filed under the generic service"
              value={pct(h.generic_bucket / h.total, 1)}
              meta={`${fmt(h.generic_bucket)} tickets in “Emailed Support Tickets”`}
            />
          </section>

          <div className={row}>
            <Card className={span[8]}>
              <CardHeader>
                <div>
                  <CardTitle>Weekly ticket intake</CardTitle>
                  <CardDescription>
                    {h.weekly.length} complete weeks · dashed line projects the linear trend{" "}
                    {HORIZON_WEEKS} weeks ahead
                  </CardDescription>
                </div>
                <Legend>
                  <LegendItem>
                    <Key tone="accent" />
                    Tickets
                  </LegendItem>
                  <LegendItem>
                    <Key tone="trend" />
                    Trend
                  </LegendItem>
                  <LegendItem>
                    <Key tone="dashed" />
                    Projection, 95% range
                  </LegendItem>
                </Legend>
              </CardHeader>
              <ForecastChart points={forecast.points} />
              <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-divider pt-3.5 max-sm:gap-3">
                <InlineFact label="Average week">{fmt(forecast.meanWeekly)}</InlineFact>
                <InlineFact label={`Next ${HORIZON_WEEKS} weeks`}>
                  {fmt(forecast.nextWeeks)}{" "}
                  <small className={factNote}>± {fmt(forecast.nextWeeksBand)}</small>
                </InlineFact>
                <InlineFact label="Trend">
                  {forecast.slope >= 0 ? "+" : ""}
                  {fmt(forecast.slope, 2)} <small className={factNote}>tickets per week</small>
                </InlineFact>
              </dl>
            </Card>
            <Card className={span[4]}>
              <CardHeader>
                <div>
                  <CardTitle>How tickets ended</CardTitle>
                  <CardDescription>
                    Closed tickets by resolution, then tickets still open
                  </CardDescription>
                </div>
              </CardHeader>
              <BarList rows={ticketOutcomes(h)} total={h.total} />
            </Card>
          </div>

          <div className={row}>
            <Card className={span[7]}>
              <CardHeader>
                <div>
                  <CardTitle>Tickets by affected service</CardTitle>
                </div>
                <Legend>
                  <LegendItem>
                    <KeyBox accent />
                    Critical
                  </LegendItem>
                  <LegendItem>
                    <KeyBox />
                    Non-critical
                  </LegendItem>
                </Legend>
              </CardHeader>
              <BarList rows={services} total={h.total} />
            </Card>
            <Card className={span[5]}>
              <CardHeader>
                <div>
                  <CardTitle>Tickets by service team</CardTitle>
                </div>
              </CardHeader>
              <BarList rows={teams} total={h.total} />
            </Card>
          </div>
        </div>
      </div>

      {/* The old margins collapsed here, leaving the section gap minus one card gap; keep that. */}
      <div className="-mt-card-gap">
        <SectionHead>
          <SectionTitle>
            Incoming queue
            <SectionCount>{queue.total}</SectionCount>
          </SectionTitle>
          <SectionText>The challenge tickets waiting in TicketBuddy</SectionText>
        </SectionHead>

        <div className="flex flex-col gap-card-gap">
          <div className={row}>
            <Card className={span[4]}>
              <CardHeader>
                <div>
                  <CardTitle>By priority</CardTitle>
                  <CardDescription>Urgency × Impact from the current triage</CardDescription>
                </div>
                <b className={cardValue}>{queue.total}</b>
              </CardHeader>
              <BarList rows={queue.priorities} />
              <p className="mt-3 text-sm text-muted">
                {queue.critical} of {queue.total} tickets affect a critical service.
              </p>
            </Card>
            <Card className={span[4]}>
              <CardHeader>
                <div>
                  <CardTitle>By status</CardTitle>
                  <CardDescription>Where each incoming ticket stands</CardDescription>
                </div>
                <Link to="/tickets" className={buttonVariants({ variant: "ghost" })}>
                  Open tickets
                  <ArrowRight size={16} strokeWidth={1.75} />
                </Link>
              </CardHeader>
              <ul className="grid">
                {queue.statuses.map((row) => (
                  <li
                    key={row.status}
                    className={cn("flex h-9.5 items-center gap-2.5 text-secondary", divided)}
                  >
                    <Dot tone={STATUS_DOTS[row.status]} />
                    {STATUS_LABELS[row.status]}
                    <b className="ml-auto font-semibold text-foreground tabular-nums">
                      {row.value}
                    </b>
                  </li>
                ))}
              </ul>
            </Card>
            {ai.covered > 0 && (
              <Card className={span[4]}>
                <CardHeader>
                  <div>
                    <CardTitle>AI triage</CardTitle>
                    <CardDescription>
                      Suggestions for {ai.covered} of {ai.total} incoming tickets
                    </CardDescription>
                  </div>
                </CardHeader>
                <dl className="grid">
                  <Fact label="Service corrected vs reporter">{ai.serviceChanged}</Fact>
                  <Fact label="Work type corrected">{ai.workChanged}</Fact>
                  <Fact label="Priority changed">{ai.priorityChanged}</Fact>
                  {ai.meanLatency !== null && (
                    <Fact label="Processing time per ticket">
                      {fmt(ai.meanLatency / 1000, 1)} s
                    </Fact>
                  )}
                  {ai.meanCost !== null && (
                    <Fact label="Model cost per ticket">CHF {fmt(ai.meanCost, 3)}</Fact>
                  )}
                </dl>
              </Card>
            )}
          </div>

          {ai.reviewed > 0 && (
            <div className={row}>
              <Card className={span[6]}>
                <CardHeader>
                  <div>
                    <CardTitle>Operator agreement with AI</CardTitle>
                    <CardDescription>
                      {ai.reviewed} ticket{ai.reviewed === 1 ? "" : "s"} handled · {ai.untouched}{" "}
                      without any change
                    </CardDescription>
                  </div>
                  <b className={cardValue}>{pct(ai.untouched / ai.reviewed)}</b>
                </CardHeader>
                <Bars>
                  {ai.fieldKept.map((row) => (
                    <Bar
                      key={row.field}
                      label={`${FIELD_LABELS[row.field]} kept`}
                      width={pct(row.rate)}
                      tone="accent"
                      value={pct(row.rate)}
                    />
                  ))}
                </Bars>
              </Card>
              <Card className={span[6]}>
                <CardHeader>
                  <div>
                    <CardTitle>Corrections made by operators</CardTitle>
                    <CardDescription>
                      AI value replaced before assigning or resolving
                    </CardDescription>
                  </div>
                </CardHeader>
                {ai.corrections.length ? (
                  <ol className="grid">
                    {ai.corrections.map((item) => (
                      <li
                        key={`${item.field}-${item.proposed}-${item.final}`}
                        className={cn("grid grid-cols-correction gap-2 py-2.5 text-sm", divided)}
                      >
                        <span className="text-muted">{fieldLabel(item.field)}</span>
                        <span>
                          <span className="text-muted line-through decoration-chart-strike">
                            {item.proposed || "—"}
                          </span>
                          <span className="mx-1.5 text-muted">→</span>
                          {item.final || "—"}
                        </span>
                        <b className="tabular-nums">×{item.count}</b>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-muted">Operators have not changed any AI value so far.</p>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

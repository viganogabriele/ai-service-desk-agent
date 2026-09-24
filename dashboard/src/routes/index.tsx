import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, CalendarDays, Info } from "lucide-react";
import { useDashboard } from "../state";
import { SERVICES } from "../domain";
import { BarList, ColumnChart, ForecastChart, StackedBar } from "../components/charts";
import {
  economics,
  hourlyProfile,
  queuePrediction,
  reviewStats,
  weeklyForecast,
} from "../insights";
import type { EconomicsInput } from "../insights";

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

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="card kpi span-3">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small className="kpi-meta">{meta}</small>
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
    <label className="number-field">
      <span>
        {label}
        <em className={tag === "Assumption" ? "tag assumption" : "tag"}>{tag}</em>
      </span>
      <span className="number-input">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value)))}
        />
        {suffix && <span>{suffix}</span>}
      </span>
    </label>
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
      <div className="page-heading">
        <div>
          <span className="utility">Operations · Insights</span>
          <h1>Service desk insights</h1>
          <p>Demand, routing quality, AI review outcomes and the cost of triage.</p>
        </div>
        <span className="pill">
          <CalendarDays size={14} strokeWidth={1.75} />
          {dayLabel(h.first_day)} – {dayLabel(h.last_day)} 2026 · {h.days} days
        </span>
      </div>

      <section className="grid" aria-label="Headline KPIs">
        <Stat
          label="Historical tickets"
          value={fmt(h.total)}
          meta={`${fmt(daily, 1)} per day · ${fmt(h.status["in progress"] ?? 0)} in progress · ${fmt(
            h.status.open ?? 0,
          )} open`}
        />
        <Stat
          label="“Done” actually resolved"
          value={pct(resolvedDone / done, 1)}
          meta={`${fmt(resolvedDone)} of ${fmt(done)} done carry Resolution “done”`}
        />
        <Stat
          label="Generic service bucket"
          value={pct(h.generic_bucket / h.total, 1)}
          meta={`${fmt(h.generic_bucket)} tickets need routing to a real service`}
        />
        <div className="card kpi span-3">
          <span className="kpi-label">
            <i className="dot accent" />
            Challenge queue reviewed
          </span>
          <strong className="kpi-value">
            {stats.total - stats.open} / {stats.total}
          </strong>
          <small className="kpi-meta">
            {stats.resolved} resolved · {stats.escalated} escalated · {stats.clarification}{" "}
            clarification
          </small>
        </div>
      </section>

      <h2 className="section-title">Demand & forecast</h2>
      <div className="grid">
        <section className="card span-8">
          <div className="card-head">
            <div>
              <h2>Weekly intake</h2>
              <p>
                {h.weekly.length} complete weeks · linear trend with an {HORIZON_WEEKS}-week
                projection
              </p>
            </div>
            <div className="legend-inline">
              <span>
                <i className="key accent" />
                Actual
              </span>
              <span>
                <i className="key muted-line" />
                Trend
              </span>
              <span>
                <i className="key dashed" />
                Projection · 95% band
              </span>
            </div>
          </div>
          <ForecastChart points={forecast.points} />
        </section>
        <section className="card span-4 forecast-card">
          <div className="card-head">
            <div>
              <h2>Projection</h2>
              <p>Statistical extrapolation, not a capacity test.</p>
            </div>
          </div>
          <dl className="facts">
            <div>
              <dt>Next {HORIZON_WEEKS} weeks</dt>
              <dd>
                {fmt(forecast.nextWeeks)}
                <small>± {fmt(forecast.nextWeeksBand)}</small>
              </dd>
            </div>
            <div>
              <dt>Next 30 days</dt>
              <dd>{fmt(next30)}</dd>
            </div>
            <div>
              <dt>Trend</dt>
              <dd>
                {Math.abs(forecast.slope) < 0.5
                  ? "Flat"
                  : `${forecast.slope > 0 ? "+" : ""}${fmt(forecast.slope, 1)}`}
                <small>{fmt(forecast.slope, 2)} tickets / week per week</small>
              </dd>
            </div>
            <div>
              <dt>L2 review load, 30 days</dt>
              <dd>
                {fmt((next30 * assumptions.reviewShare * assumptions.reviewMinutes) / 60)} h
                <small>at {assumptions.reviewMinutes} min / ticket</small>
              </dd>
            </div>
          </dl>
          <p className="insight">
            <Info size={14} strokeWidth={1.75} />
            Weekly volume moves only ±{pct(
              (1.96 * forecast.sigma) / forecast.meanWeekly,
            )} around{" "}
            {fmt(forecast.meanWeekly)}: demand is steady, so throughput sizing matters more than
            peak handling.
          </p>
        </section>
      </div>
      <div className="grid">
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2>Intake by hour of day</h2>
              <p>All weekdays combined · line marks the hourly mean</p>
            </div>
            <b className="card-value">+{pct(profile.peakLift, 1)} peak</b>
          </div>
          <ColumnChart values={profile.hours} labels={hourLabels} label="Tickets by hour of day" />
          <p className="insight">
            <Info size={14} strokeWidth={1.75} />
            Busiest hour {hourLabels[profile.peakHour]} is only {pct(profile.peakLift, 1)} above the
            mean and weekdays differ by {pct(profile.weekdaySpread, 1)}: tickets arrive around the
            clock, which favours automated first-pass triage.
          </p>
        </section>
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2>How “done” tickets ended</h2>
              <p>Status “done” includes outcomes other than resolved.</p>
            </div>
            <b className="card-value">{fmt(done)}</b>
          </div>
          <StackedBar
            total={done}
            rows={Object.entries(h.resolution)
              .map(([label, value]) => ({ label, value }))
              .sort((a, b) => Number(b.label === "done") - Number(a.label === "done"))}
          />
          <p className="insight">
            <Info size={14} strokeWidth={1.75} />
            {pct(1 - resolvedDone / done)} of closed tickets were cancelled, not reproducible or
            waiting on clarification: a clear request up front avoids most of that rework.
          </p>
        </section>
      </div>

      <h2 className="section-title">Routing</h2>
      <div className="grid">
        <section className="card span-7">
          <div className="card-head">
            <div>
              <h2>Tickets by affected service</h2>
              <p>Historical file · {SERVICES.length} services</p>
            </div>
            <div className="legend-inline">
              <span>
                <i className="key-box accent" />
                Critical
              </span>
              <span>
                <i className="key-box" />
                Non-Critical
              </span>
            </div>
          </div>
          <BarList rows={services} total={h.total} />
        </section>
        <div className="span-5 stack">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Tickets by team</h2>
                <p>Derived 1:1 from the service</p>
              </div>
            </div>
            <BarList rows={sortedRows(h.team)} total={h.total} />
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Tickets by business entity</h2>
              </div>
            </div>
            <BarList rows={sortedRows(h.entity)} total={h.total} />
          </section>
        </div>
      </div>

      <h2 className="section-title">
        AI triage performance {data.mock && <span className="mock-mini">Mock proposals</span>}
      </h2>
      <div className="grid">
        <section className="card span-12">
          <div className="card-head">
            <div>
              <h2>Review outcomes · challenge queue</h2>
              <p>
                From the operator action log · {stats.regenerated} ticket
                {stats.regenerated === 1 ? "" : "s"} regenerated with a stronger model
              </p>
            </div>
            <div className="progress">
              <b>{stats.resolved ? pct(stats.accepted / stats.resolved) : "—"}</b>
              <small className="muted">accepted without edits</small>
            </div>
          </div>
          <StackedBar total={stats.total} rows={outcomeRows} />
        </section>
      </div>
      <div className="grid">
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>Proposal kept, by field</h2>
              <p>Share of resolved tickets where the operator kept the AI value</p>
            </div>
          </div>
          {stats.resolved === 0 ? (
            <EmptyReview />
          ) : (
            <div className="bar-list">
              {stats.fieldAgreement.map((row) => (
                <div className="bar-row" key={row.field}>
                  <span className="bar-name">{FIELD_LABELS.get(row.field)}</span>
                  <span className="bar-track">
                    <span className="bar-fill accent" style={{ width: pct(row.rate ?? 0) }} />
                  </span>
                  <span className="bar-value num">{row.rate === null ? "—" : pct(row.rate)}</span>
                </div>
              ))}
              <p className="card-note">
                Resolution comment edited on {pct(stats.commentEdited ?? 0)} of resolved tickets.
              </p>
            </div>
          )}
        </section>
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>Most frequent corrections</h2>
              <p>Where operators overrode the proposal</p>
            </div>
          </div>
          {stats.corrections.length === 0 ? (
            stats.resolved === 0 ? (
              <EmptyReview />
            ) : (
              <p className="muted">No field corrections among resolved tickets.</p>
            )
          ) : (
            <ol className="corrections">
              {stats.corrections.map((item) => (
                <li key={`${item.field}-${item.proposed}-${item.final}`}>
                  <span className="muted">{FIELD_LABELS.get(item.field) ?? item.field}</span>
                  <span>
                    <span className="old-value">{item.proposed || "—"}</span>
                    <span className="change-arrow">→</span>
                    {item.final || "—"}
                  </span>
                  <b className="num">×{item.count}</b>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>Incoming queue prediction</h2>
              <p>Priority mix of the current proposals</p>
            </div>
          </div>
          <BarList
            rows={queue.levels.map((row) => ({
              label: row.level,
              value: row.count,
              highlight: row.level === "Highest" || row.level === "High",
            }))}
          />
          <dl className="facts compact">
            <div>
              <dt>Critical services</dt>
              <dd>
                {queue.critical} / {stats.total}
              </dd>
            </div>
            <div>
              <dt>Service re-routed</dt>
              <dd>{queue.serviceChanged}</dd>
            </div>
            <div>
              <dt>Mean service confidence</dt>
              <dd>{queue.meanConfidence === null ? "Not measured" : pct(queue.meanConfidence)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <h2 className="section-title">Models & cost</h2>
      <div className="grid">
        <section className="card span-12 table-card">
          <div className="card-head">
            <div>
              <h2>Model comparison</h2>
              <p>
                {data.models_source === "dev_run"
                  ? "Measured on the saved local development run (output/dev_predictions.json)."
                  : data.models_source === "file"
                    ? "Read from dashboard/data/models.json."
                    : "No model metrics available."}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Kind</th>
                  <th className="right">Latency p50</th>
                  <th className="right">Latency p95</th>
                  <th className="right">Cost / ticket</th>
                  <th className="right">Service acc.</th>
                  <th className="right">Work type acc.</th>
                  <th>Evaluation set</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.model_id}>
                    <td>
                      <span className="value">{model.label}</span>
                      <small>{model.model_id}</small>
                    </td>
                    <td>{model.kind}</td>
                    <td className="right num">
                      {model.latency_ms_p50 == null
                        ? "Not measured"
                        : `${fmt(model.latency_ms_p50 / 1000, 2)} s`}
                    </td>
                    <td className="right num">
                      {model.latency_ms_p95 == null
                        ? "Not measured"
                        : `${fmt(model.latency_ms_p95 / 1000, 2)} s`}
                    </td>
                    <td className="right num" title={model.cost_note}>
                      {model.cost_chf_per_ticket == null
                        ? "Not measured"
                        : chf(model.cost_chf_per_ticket)}
                    </td>
                    <td className="right num">
                      {model.holdout?.accuracy.service == null
                        ? "Not measured"
                        : pct(model.holdout.accuracy.service)}
                    </td>
                    <td className="right num">
                      {model.holdout?.accuracy.work_type == null
                        ? "Not measured"
                        : pct(model.holdout.accuracy.work_type)}
                    </td>
                    <td>
                      {model.holdout
                        ? `n = ${model.holdout.n} · ${model.holdout.label ?? "hold-out"}`
                        : "—"}
                    </td>
                  </tr>
                ))}
                {premium.url && !data.models.some((model) => model.kind === "premium") && (
                  <tr>
                    <td>
                      <span className="value">Premium solver</span>
                      <small>{premium.model ?? premium.url}</small>
                    </td>
                    <td>premium</td>
                    <td className="right">Not measured</td>
                    <td className="right">Not measured</td>
                    <td className="right">Not measured</td>
                    <td className="right">Not measured</td>
                    <td className="right">Not measured</td>
                    <td>{premium.online ? "Online" : "Offline"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="card-note table-note">
            Accuracy is measured on labelled data only. Assignee, Priority and Resolution text are
            not evaluated for lack of ground truth; {data.models[0]?.holdout?.n ?? 0} labelled cases
            are not a benchmark.
          </p>
        </section>
      </div>
      <div className="grid">
        <section className="card span-12">
          <div className="card-head">
            <div>
              <h2>Unit economics</h2>
              <p>Assisted triage vs fully manual triage. Every input is editable.</p>
            </div>
          </div>
          <div className="economics">
            <div className="economics-inputs">
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
            <div className="economics-output">
              <div className="hero-saving">
                <span className="kpi-label">Estimated yearly saving at today's volume</span>
                <strong className={scenarios[0].savingYear >= 0 ? "" : "negative"}>
                  {chf(scenarios[0].savingYear)}
                </strong>
                <small className="kpi-meta">
                  {fmt(scenarios[0].hoursSavedDay, 1)} L2 hours freed per day · model spend{" "}
                  {chf(scenarios[0].modelDay * 365)} / year
                </small>
              </div>
              <table className="compact-table scenario-table">
                <thead>
                  <tr>
                    <th>Per day</th>
                    <th className="right">1× volume</th>
                    <th className="right">10× volume</th>
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
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="right num">{value(scenarios[0])}</td>
                      <td className="right num">{value(scenarios[1])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="insight">
                <Info size={14} strokeWidth={1.75} />
                At 10× volume one serial worker needs {fmt(scenarios[1].computeHoursDay, 1)} compute
                hours a day
                {workers > 1 ? `, so at least ${workers} parallel workers` : ", within one worker"}.
                Throughput scaling is untested.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function EmptyReview() {
  return (
    <div className="empty-inline">
      <p>No resolved tickets yet.</p>
      <Link to="/tickets" className="button">
        Open the ticket workspace
        <ArrowRight size={16} strokeWidth={1.75} />
      </Link>
    </div>
  );
}

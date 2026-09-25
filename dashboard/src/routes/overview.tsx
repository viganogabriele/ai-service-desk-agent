import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useDashboard } from "../state";
import { FIELD_LABELS, SERVICES, STATUS_DOTS, STATUS_LABELS, fieldLabel } from "../domain";
import { BarList, ForecastChart } from "../components/charts";
import { aiStats, queueStats, ticketOutcomes, weeklyForecast } from "../insights";

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

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="card kpi span-3">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small className="kpi-meta">{meta}</small>
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
    <>
      <div className="section-head">
        <h1>Overview</h1>
        <p>
          {fmt(h.total)} Jira service desk tickets created {dayLabel(h.first_day)} –{" "}
          {dayLabel(h.last_day)}
        </p>
      </div>

      <section className="grid" aria-label="Key figures">
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

      <div className="grid">
        <section className="card span-8">
          <div className="card-head">
            <div>
              <h2>Weekly ticket intake</h2>
              <p>
                {h.weekly.length} complete weeks · dashed line projects the linear trend{" "}
                {HORIZON_WEEKS} weeks ahead
              </p>
            </div>
            <div className="legend-inline">
              <span>
                <i className="key accent" />
                Tickets
              </span>
              <span>
                <i className="key muted-line" />
                Trend
              </span>
              <span>
                <i className="key dashed" />
                Projection, 95% range
              </span>
            </div>
          </div>
          <ForecastChart points={forecast.points} />
          <dl className="inline-facts">
            <div>
              <dt>Average week</dt>
              <dd>{fmt(forecast.meanWeekly)}</dd>
            </div>
            <div>
              <dt>Next {HORIZON_WEEKS} weeks</dt>
              <dd>
                {fmt(forecast.nextWeeks)} <small>± {fmt(forecast.nextWeeksBand)}</small>
              </dd>
            </div>
            <div>
              <dt>Trend</dt>
              <dd>
                {forecast.slope >= 0 ? "+" : ""}
                {fmt(forecast.slope, 2)} <small>tickets per week</small>
              </dd>
            </div>
          </dl>
        </section>
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>How tickets ended</h2>
              <p>Closed tickets by resolution, then tickets still open</p>
            </div>
          </div>
          <BarList rows={ticketOutcomes(h)} total={h.total} />
        </section>
      </div>

      <div className="grid">
        <section className="card span-7">
          <div className="card-head">
            <div>
              <h2>Tickets by affected service</h2>
            </div>
            <div className="legend-inline">
              <span>
                <i className="key-box accent" />
                Critical
              </span>
              <span>
                <i className="key-box" />
                Non-critical
              </span>
            </div>
          </div>
          <BarList rows={services} total={h.total} />
        </section>
        <section className="card span-5">
          <div className="card-head">
            <div>
              <h2>Tickets by service team</h2>
            </div>
          </div>
          <BarList rows={teams} total={h.total} />
        </section>
      </div>

      <div className="section-head">
        <h2>
          Incoming queue
          <span className="count num">{queue.total}</span>
        </h2>
        <p>The challenge tickets waiting in TicketBuddy</p>
      </div>
      <div className="grid">
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>By priority</h2>
              <p>Urgency × Impact from the current triage</p>
            </div>
            <b className="card-value">{queue.total}</b>
          </div>
          <BarList rows={queue.priorities} />
          <p className="card-note">
            {queue.critical} of {queue.total} tickets affect a critical service.
          </p>
        </section>
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2>By status</h2>
              <p>Where each incoming ticket stands</p>
            </div>
            <Link to="/tickets" className="button ghost">
              Open tickets
              <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
          </div>
          <ul className="status-list">
            {queue.statuses.map((row) => (
              <li key={row.status}>
                <i className={`dot ${STATUS_DOTS[row.status]}`} />
                {STATUS_LABELS[row.status]}
                <b className="num">{row.value}</b>
              </li>
            ))}
          </ul>
        </section>
        {ai.covered > 0 && (
          <section className="card span-4">
            <div className="card-head">
              <div>
                <h2>AI triage</h2>
                <p>
                  Suggestions for {ai.covered} of {ai.total} incoming tickets
                </p>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>Service corrected vs reporter</dt>
                <dd>{ai.serviceChanged}</dd>
              </div>
              <div>
                <dt>Work type corrected</dt>
                <dd>{ai.workChanged}</dd>
              </div>
              <div>
                <dt>Priority changed</dt>
                <dd>{ai.priorityChanged}</dd>
              </div>
              {ai.meanLatency !== null && (
                <div>
                  <dt>Processing time per ticket</dt>
                  <dd>{fmt(ai.meanLatency / 1000, 1)} s</dd>
                </div>
              )}
              {ai.meanCost !== null && (
                <div>
                  <dt>Model cost per ticket</dt>
                  <dd>CHF {fmt(ai.meanCost, 3)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}
      </div>

      {ai.reviewed > 0 && (
        <div className="grid">
          <section className="card span-6">
            <div className="card-head">
              <div>
                <h2>Operator agreement with AI</h2>
                <p>
                  {ai.reviewed} ticket{ai.reviewed === 1 ? "" : "s"} handled · {ai.untouched}{" "}
                  without any change
                </p>
              </div>
              <b className="card-value">{pct(ai.untouched / ai.reviewed)}</b>
            </div>
            <div className="bar-list">
              {ai.fieldKept.map((row) => (
                <div className="bar-row" key={row.field}>
                  <span className="bar-name">{FIELD_LABELS[row.field]} kept</span>
                  <span className="bar-track">
                    <span className="bar-fill accent" style={{ width: pct(row.rate) }} />
                  </span>
                  <span className="bar-value num">{pct(row.rate)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card span-6">
            <div className="card-head">
              <div>
                <h2>Corrections made by operators</h2>
                <p>AI value replaced before assigning or resolving</p>
              </div>
            </div>
            {ai.corrections.length ? (
              <ol className="corrections">
                {ai.corrections.map((item) => (
                  <li key={`${item.field}-${item.proposed}-${item.final}`}>
                    <span className="muted">{fieldLabel(item.field)}</span>
                    <span>
                      <span className="old-value">{item.proposed || "—"}</span>
                      <span className="change-arrow">→</span>
                      {item.final || "—"}
                    </span>
                    <b className="num">×{item.count}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Operators have not changed any AI value so far.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

import type { Bundle, Proposal } from "./domain";
import { LEVELS, STATUSES, TRIAGE_FIELDS, priority, serviceInfo } from "./domain";
import type { Action, Review } from "./state";

export interface ForecastPoint {
  week: string;
  actual: number | null;
  fitted: number;
  low: number;
  high: number;
  projected: boolean;
}

function addDays(iso: string, days: number) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/** Ordinary least squares on complete weekly intake, extended `horizon` weeks with a ±1.96σ residual band. */
export function weeklyForecast(weekly: Bundle["historical"]["weekly"], horizon: number) {
  const n = weekly.length;
  const meanX = (n - 1) / 2;
  const meanY = weekly.reduce((sum, row) => sum + row.count, 0) / n;
  let covariance = 0;
  let variance = 0;

  for (const [x, row] of weekly.entries()) {
    covariance += (x - meanX) * (row.count - meanY);
    variance += (x - meanX) ** 2;
  }

  const slope = variance ? covariance / variance : 0;
  const intercept = meanY - slope * meanX;
  const fit = (x: number) => intercept + slope * x;

  const sigma = Math.sqrt(
    weekly.reduce((sum, row, x) => sum + (row.count - fit(x)) ** 2, 0) / Math.max(1, n - 2),
  );

  const band = 1.96 * sigma;
  const last = weekly[n - 1]?.week ?? "";

  const points: ForecastPoint[] = [
    ...weekly.map((row, x) => ({
      week: row.week,
      actual: row.count,
      fitted: fit(x),
      low: fit(x) - band,
      high: fit(x) + band,
      projected: false,
    })),
    ...Array.from({ length: horizon }, (_, step) => {
      const x = n + step;

      return {
        week: addDays(last, 7 * (step + 1)),
        actual: null,
        fitted: fit(x),
        low: fit(x) - band,
        high: fit(x) + band,
        projected: true,
      };
    }),
  ];

  return {
    points,
    slope,
    meanWeekly: meanY,
    nextWeeks: points.filter((point) => point.projected).reduce((sum, point) => sum + point.fitted, 0),
    // Band of a sum of independent weekly residuals.
    nextWeeksBand: band * Math.sqrt(horizon),
  };
}

const OUTCOME_ROWS = [
  ["done", "Resolved"],
  ["clarification", "Needed clarification"],
  ["cannot reproduce", "Cannot reproduce"],
  ["cancelled", "Cancelled"],
] as const;

/** Every historical ticket by where it ended up: the four resolutions of "done", then still-open states. */
export function ticketOutcomes(historical: Bundle["historical"]) {
  return [
    ...OUTCOME_ROWS.map(([key, label]) => ({
      label,
      value: historical.resolution[key] ?? 0,
      highlight: key === "done",
    })),
    { label: "In progress", value: historical.status["in progress"] ?? 0, highlight: false },
    { label: "Open", value: historical.status.open ?? 0, highlight: false },
  ];
}

// Same colours as the priority badges: red for the urgent levels, yellow for medium, green below.
const PRIORITY_TONES = {
  Highest: "danger",
  High: "danger",
  Medium: "warning",
  Low: "success",
  Lowest: "success",
} as const;

export function queueStats(data: Bundle, review: (index: number) => Review) {
  const reviews = data.challenge.map((_, index) => review(index));

  return {
    priorities: LEVELS.map((level) => ({
      label: level,
      value: reviews.filter((item) => priority(item.triage.urgency, item.triage.impact) === level)
        .length,
      tone: PRIORITY_TONES[level],
    })),
    statuses: STATUSES.map((status) => ({
      status,
      value: reviews.filter((item) => item.status === status).length,
    })),
    critical: reviews.filter((item) => serviceInfo(item.triage.service)?.[2] === "Critical").length,
    total: reviews.length,
  };
}

const DECISIVE = new Set<Action["action"]>(["assign", "resolve", "ask"]);

/** What the AI changed versus the reporter, and — once operators act — how often they kept its values. */
export function aiStats(
  data: Bundle,
  proposals: (Proposal | null)[],
  actions: Action[],
  review: (index: number) => Review,
) {
  // Undo and reopen restore a ticket without removing its log entry, so only current decisions count.
  const decided = new Set(
    data.challenge.flatMap((_, index) =>
      ["assigned", "waiting", "resolved"].includes(review(index).status)
        ? [`CH-${String(index + 1).padStart(2, "0")}`]
        : [],
    ),
  );

  const pairs = data.challenge.flatMap((ticket, index) => {
    const proposal = proposals[index];

    return proposal ? [{ ticket, proposal }] : [];
  });

  const latencies = pairs.flatMap(({ proposal }) =>
    proposal.latency_ms == null ? [] : [proposal.latency_ms],
  );

  const costs = pairs.flatMap(({ proposal }) =>
    proposal.cost_chf == null ? [] : [proposal.cost_chf],
  );

  const latest = new Map<string, Action>();

  for (const action of actions)
    if (action.model_id && DECISIVE.has(action.action) && decided.has(action.ticket_id))
      latest.set(action.ticket_id, action);

  const changedBy = new Map<string, number>();
  const corrections = new Map<string, number>();
  let untouched = 0;

  for (const action of latest.values()) {
    if (action.changed_fields.length === 0) untouched += 1;

    for (const change of action.changed_fields) {
      changedBy.set(change.field, (changedBy.get(change.field) ?? 0) + 1);
      const key = `${change.field}\u0000${change.proposed}\u0000${change.final}`;
      corrections.set(key, (corrections.get(key) ?? 0) + 1);
    }
  }

  return {
    covered: pairs.length,
    total: data.challenge.length,
    serviceChanged: pairs.filter(
      ({ ticket, proposal }) =>
        proposal.proposal.service !== ticket["Affected Business or IT Services"][0],
    ).length,
    workChanged: pairs.filter(
      ({ ticket, proposal }) => proposal.proposal.work_type !== ticket["Work type"],
    ).length,
    priorityChanged: pairs.filter(
      ({ ticket, proposal }) =>
        priority(proposal.proposal.urgency, proposal.proposal.impact) !==
        priority(ticket.Urgency, ticket.Impact),
    ).length,
    meanLatency: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : null,
    latencySamples: latencies.length,
    meanCost: costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : null,
    reviewed: latest.size,
    untouched,
    fieldKept: TRIAGE_FIELDS.map((field) => ({
      field,
      rate: latest.size ? 1 - (changedBy.get(field) ?? 0) / latest.size : 0,
    })),
    corrections: [...corrections.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [field, proposed, final] = key.split("\u0000");

        return { field, proposed, final, count };
      }),
  };
}

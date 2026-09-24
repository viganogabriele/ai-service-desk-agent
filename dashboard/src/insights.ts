import type { Bundle, Level } from "./domain";
import { LEVELS, priority, serviceInfo } from "./domain";
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

  const projected = points.filter((point) => point.projected);

  return {
    points,
    slope,
    sigma,
    meanWeekly: meanY,
    nextWeeks: projected.reduce((sum, point) => sum + point.fitted, 0),
    nextWeeksBand: band * Math.sqrt(horizon),
  };
}

export function hourlyProfile(heatmap: number[][]) {
  const hours = Array.from({ length: 24 }, (_, hour) =>
    heatmap.reduce((sum, day) => sum + day[hour], 0),
  );

  const weekdays = heatmap.map((day) => day.reduce((sum, value) => sum + value, 0));
  const mean = hours.reduce((sum, value) => sum + value, 0) / hours.length;
  const peak = Math.max(...hours);

  return {
    hours,
    weekdays,
    mean,
    peakHour: hours.indexOf(peak),
    peakLift: mean ? peak / mean - 1 : 0,
    weekdaySpread: Math.max(...weekdays) / Math.min(...weekdays) - 1,
  };
}

const RESOLVING = new Set(["accept", "modify"]);

/** Outcome counts from current reviews and per-field agreement from each ticket's latest resolving action. */
export function reviewStats(
  data: Bundle,
  reviews: (index: number) => Review,
  actions: Action[],
  regeneratedCount: number,
) {
  const statuses = data.challenge.map((_, index) => reviews(index).status);
  const count = (status: string) => statuses.filter((item) => item === status).length;
  const accepted = count("accepted");
  const modified = count("modified_accepted");
  const resolvedIds = new Set<string>();

  for (const [index, status] of statuses.entries())
    if (status === "accepted" || status === "modified_accepted")
      resolvedIds.add(data.proposals[index].ticket_id);

  const latest = new Map<string, Action>();

  for (const action of actions)
    if (RESOLVING.has(action.action) && resolvedIds.has(action.ticket_id))
      latest.set(action.ticket_id, action);

  const fields = ["work_type", "service", "assignee", "urgency", "impact", "resolution"];
  const changedBy = new Map<string, number>();
  const corrections = new Map<string, number>();

  for (const action of latest.values())
    for (const change of action.changed_fields) {
      changedBy.set(change.field, (changedBy.get(change.field) ?? 0) + 1);

      if (change.field !== "resolution_comment") {
        const key = `${change.field}\u0000${change.proposed}\u0000${change.final}`;
        corrections.set(key, (corrections.get(key) ?? 0) + 1);
      }
    }

  return {
    total: statuses.length,
    accepted,
    modified,
    escalated: count("escalated"),
    clarification: count("clarification_requested"),
    open: count("to_process") + count("proposed") + count("in_review"),
    regenerated: regeneratedCount,
    resolved: accepted + modified,
    fieldAgreement: fields.map((field) => ({
      field,
      rate: latest.size ? 1 - (changedBy.get(field) ?? 0) / latest.size : null,
    })),
    commentEdited: latest.size ? (changedBy.get("resolution_comment") ?? 0) / latest.size : null,
    corrections: [...corrections.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, value]) => {
        const [field, proposed, final] = key.split("\u0000");

        return { field, proposed, final, count: value };
      }),
  };
}

export function queuePrediction(data: Bundle, reviews: (index: number) => Review) {
  const levels = new Map<Level, number>(LEVELS.map((level) => [level, 0]));
  let critical = 0;
  let serviceChanged = 0;

  for (const [index, ticket] of data.challenge.entries()) {
    const form = reviews(index).form;
    const level = priority(form.urgency, form.impact);
    levels.set(level, (levels.get(level) ?? 0) + 1);

    if (serviceInfo(form.service)?.[2] === "Critical") critical += 1;

    if (ticket["Affected Business or IT Services"][0] !== form.service) serviceChanged += 1;
  }

  const confidences = data.proposals.flatMap((proposal) =>
    proposal.confidence.service === null ? [] : [proposal.confidence.service],
  );

  return {
    levels: LEVELS.map((level) => ({ level, count: levels.get(level) ?? 0 })),
    critical,
    serviceChanged,
    lowConfidence: confidences.filter((value) => value < 0.5).length,
    meanConfidence: confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null,
  };
}

export interface EconomicsInput {
  volumePerDay: number;
  manualMinutes: number;
  reviewMinutes: number;
  reviewShare: number;
  hourlyCost: number;
  baseCost: number;
  premiumShare: number;
  premiumCost: number;
  latencySeconds: number;
}

/** ADVISOR_REVIEW.md cost model: model cost + review labour vs. fully manual triage. */
export function economics(input: EconomicsInput, multiplier: number) {
  const volume = input.volumePerDay * multiplier;
  const modelPerTicket = input.baseCost + input.premiumShare * input.premiumCost;
  const reviewPerTicket = (input.reviewShare * input.reviewMinutes * input.hourlyCost) / 60;
  const manualPerTicket = (input.manualMinutes * input.hourlyCost) / 60;
  const assistedDay = volume * (modelPerTicket + reviewPerTicket);
  const manualDay = volume * manualPerTicket;

  return {
    volume,
    modelPerTicket,
    totalPerTicket: modelPerTicket + reviewPerTicket,
    manualPerTicket,
    modelDay: volume * modelPerTicket,
    assistedDay,
    manualDay,
    savingDay: manualDay - assistedDay,
    savingYear: (manualDay - assistedDay) * 365,
    hoursSavedDay:
      (volume * (input.manualMinutes - input.reviewShare * input.reviewMinutes)) / 60,
    computeHoursDay: (volume * input.latencySeconds) / 3600,
  };
}

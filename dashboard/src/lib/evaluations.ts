export const EVALUATION_FIELDS = {
  service: "Service",
  work_type: "Work type",
  team: "Team",
  assignee: "Assignee",
  urgency: "Urgency",
  impact: "Impact",
  priority: "Priority",
  resolution: "Resolution",
};

export interface FieldScore {
  n: number;
  n_labelled: number;
  agree_label: number;
  agreement_label: number | null;
  agreement_live: number | null;
}

export interface EvaluationCase {
  ticket_id: string;
  title?: string;
  status: string;
  seconds: number | null;
  error?: string | null;
  checks?: { field: string; prediction: string | null; label: string | null }[];
}

export interface Evaluation {
  evaluation_id: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  ticket_ids: string[];
  request: { ticket_set: string; days?: number };
  results: {
    versions: { model: string; prompt?: string; kb?: string; policy?: string };
    summary: { tickets: number; failed: number; changed_decisions: number | null };
    per_field: Record<string, FieldScore>;
    disagreements: {
      ticket_id: string;
      field: string;
      shadow: string | null;
      live: string | null;
      label: string | null;
    }[];
    shadow_run_ids: string[];
  } | null;
  cases?: EvaluationCase[];
}

export interface EvaluationRef {
  id: string;
  model: string;
  dataset: string;
}

interface ShadowRun {
  ticket_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

// The same backend as the rest of the dashboard: the dev proxy at /api unless overridden.
const base = (import.meta.env.VITE_BACKEND_URL || "/api").replace(/\/+$/, "");

export const historyKey = `ticketbuddy-evaluations:${base}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}/core${path}`, init);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        `Evaluation request failed (${response.status}). Check that the backend and Core are running.`,
    );
  }

  return response.json();
}

export function startEvaluation(model: string, dataset: string) {
  return request<{ evaluation_id: string; tickets: number }>("/evaluations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versions: { model }, ticket_set: dataset, days: 30 }),
  });
}

export function getEvaluation(id: string, signal: AbortSignal) {
  return request<Evaluation>(`/evaluations/${encodeURIComponent(id)}`, { signal });
}

export async function getCases(ids: string[], signal: AbortSignal): Promise<EvaluationCase[]> {
  const cases: EvaluationCase[] = [];

  // Bound concurrency so a large evaluation doesn't flood the gateway with run lookups.
  for (let offset = 0; offset < ids.length; offset += 6) {
    const runs = await Promise.all(
      ids
        .slice(offset, offset + 6)
        .map((id) => request<ShadowRun>(`/runs/${encodeURIComponent(id)}`, { signal })),
    );

    for (const run of runs) {
      const elapsed = run.completed_at
        ? (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000
        : NaN;

      cases.push({
        ticket_id: run.ticket_id,
        status: run.status,
        error: run.error,
        seconds: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      });
    }
  }

  return cases;
}

export function metrics(evaluation: Evaluation, cases: EvaluationCase[] = []) {
  const scores = Object.values(evaluation.results?.per_field ?? {});
  const labelled = scores.reduce((total, field) => total + field.n_labelled, 0);
  const correct = scores.reduce((total, field) => total + field.agree_label, 0);

  const seconds = cases
    .flatMap((item) => (item.status === "completed" && item.seconds !== null ? [item.seconds] : []))
    .sort((a, b) => a - b);

  return {
    labelled,
    correct,
    accuracy: labelled ? correct / labelled : null,
    mean: seconds.length ? seconds.reduce((total, s) => total + s, 0) / seconds.length : null,
    p95: seconds.length ? seconds[Math.ceil(seconds.length * 0.95) - 1] : null,
  };
}

export function percent(value: number | null | undefined) {
  return value == null ? "Unlabelled" : `${(value * 100).toFixed(1)}%`;
}

export function fieldName(field: string) {
  return Object.entries(EVALUATION_FIELDS).find(([key]) => key === field)?.[1] ?? field;
}

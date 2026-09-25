import {
  LEVELS,
  OUTCOMES,
  RESOLUTIONS,
  TRIAGE_FIELDS,
  serviceInfo,
  startingTriage,
} from "../domain.ts";
import type {
  Bundle,
  Explanation,
  IncomingTicket,
  Level,
  Outcome,
  Proposal,
  Resolution,
  Status,
  Ticket,
  Triage,
  TriageField,
  DecisionField,
} from "../domain.ts";

export interface TicketExport {
  fetchedAtUtc: string;
  actualIssueCount: number;
  jql: string;
  records: Ticket[];
}

export interface Health {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
  core: "configured" | "not_configured";
}

export interface TicketPatch {
  Key: string;
  "Work type"?: string;
  "Affected Business or IT Services"?: string[];
  "Service Team(s)"?: string[];
  Assignee?: string | null;
  Urgency?: Level | null;
  Impact?: Level | null;
  Resolution?: Resolution;
  "All Comments"?: string[];
  // Open <-> in progress go through a Jira transition; done needs a Resolution.
  Status?: "open" | "in progress";
}

export interface SignedInUser {
  accountId: string;
  email: string;
  name: string;
}

export interface AuthState {
  enabled: boolean;
  user: SignedInUser | null;
}

export interface PatchResult {
  key: string;
  ok: boolean;
  changed?: string[];
  warnings: string[];
  error?: string;
}

export interface PatchResponse {
  results: PatchResult[];
}

// The backend sends {error: {message, code}}; the Core, through the proxy, {error: code, message}.
interface ApiError {
  error?: { message?: string; code?: string };
  message?: string;
}

/** Set when nothing answered for the backend: the dev proxy's 502, or a host without the backend. */
export const UNREACHABLE = "backend_unreachable";

/** One field of a Core run (CORE_API §4). */
interface CoreDecision {
  effective_value: string | null;
  source: NonNullable<Explanation["source"]>;
  confidence: number;
  confidence_signals: Record<string, number>;
  reason: string;
  rule_trace: string | null;
  evidence: {
    ticket_spans: { field: string; start: number; end: number; text: string }[];
    patterns: { pattern_id: string; similarity: number; service: string; resolver: string }[];
    service_card: string | null;
  };
  alternatives: { value: string; score: number }[];
  flags: string[];
  pinned: boolean;
}

/** GET /tickets/{id} of the Core (CORE_API §4, ticket-level view). */
interface CoreTicketView {
  ticket_id: string;
  external_key: string;
  effective_state: Record<string, CoreDecision> | null;
  latest_run: {
    run_id: string;
    versions: { model: string; prompt?: string; kb?: string; policy?: string };
    audit_sampled: boolean;
    completed_at: string | null;
  } | null;
  resolution_comment: {
    text: string;
    stale: boolean;
    segments: { text: string; origin: "ticket" | "exemplar" | "generated" }[];
    exemplar_pattern_ids: string[];
    unsupported_specifics: string[];
  } | null;
  lane: "auto_applied" | "needs_review" | "human_only" | null;
  lane_reasons: string[];
  history?: { type: string; run_id?: string; fields?: string[] }[];
}

interface CoreTicketSummary {
  ticket_id: string;
  external_key: string;
  lane: string | null;
  risk?: number;
  // The latest run of any kind; null before the first one is queued.
  run_status: "queued" | "running" | "completed" | "failed" | null;
  // Present with `?expand=view`: what GET /tickets/{id} returns for this ticket.
  view?: CoreTicketView | null;
}

/** What the Core holds, by Jira key: proposals, and the latest run of every ticket it knows. */
export interface CoreState {
  proposals: Map<string, Proposal>;
  runs: Map<string, CoreTicketSummary["run_status"]>;
  signature?: string;
  expandedAt?: number;
}

/** Where the AI is with a ticket that has no suggestion yet. */
export type Classification = "queued" | "classifying" | "failed";

/**
 * Null once the Core has a suggestion, for closed tickets (the backend sends them as closures, not
 * for triage) and when there is no Core. Open tickets the backend has not sent yet are queued.
 */
export function classificationOf(
  ticket: IncomingTicket,
  core: CoreState | null,
): Classification | null {
  if (!core || ticket.Status === "done" || core.proposals.has(ticket.Key)) return null;
  const run = core.runs.get(ticket.Key);

  if (run === undefined || run === null || run === "queued") return "queued";

  // A completed run without a usable suggestion failed as far as the operator is concerned.
  return run === "running" ? "classifying" : "failed";
}

export interface CoreChange {
  field: string;
  value: string | null;
  reason_code: string;
}

// Read by the backend: overrides by "dashboard" or "dashboard:<email>" are already in Jira.
export function coreActor(user: SignedInUser | null) {
  return user ? `dashboard:${user.email}` : "dashboard";
}

/** Both the dashboard and Core consume the dataset's "email: text" format. */
export function parseComment(comment: string) {
  const match = /^(\S+@\S+):\s*([\s\S]*)$/.exec(comment.trim());

  return { author: match?.[1] ?? null, text: match?.[2] ?? comment.trim() };
}

export function signedComment(text: string, author: string) {
  // Only a copied draft ("email: Resolution: …") carries a signature to replace; typed text is kept.
  const body = text.trim().replace(/^\S+@\S+:\s*(?=Resolution: )/, "");

  return author ? `${author}: ${body}` : body;
}

export const REASON_CODES: Record<TriageField | "resolution", string> = {
  work_type: "wrong_work_type",
  service: "wrong_service",
  assignee: "wrong_assignee",
  urgency: "wrong_urgency",
  impact: "wrong_impact",
  resolution: "wrong_resolution_status",
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createBackendClient(baseUrl: string, fetcher = fetch) {
  const base = baseUrl.replace(/\/+$/, "");

  async function jsonResponse<T>(response: Response): Promise<T> {
    // The backend always answers JSON; a static host serves its HTML page for /api instead.
    if (!response.headers.get("Content-Type")?.includes("json"))
      throw new HttpError(response.status, `No backend answered at ${base}.`, UNREACHABLE);

    if (!response.ok) {
      const payload: ApiError = await response.json().catch(() => ({}));
      const message = payload.message ?? payload.error?.message;

      throw new HttpError(
        response.status,
        message ?? `Request failed (${response.status}).`,
        payload.error?.code,
      );
    }

    return response.json();
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return jsonResponse(await fetcher(`${base}${path}`, { ...init, credentials: "include" }));
  }

  return {
    tickets: async (signal?: AbortSignal, etag?: string) => {
      const response = await fetcher(`${base}/tickets`, {
        signal,
        credentials: "include",
        cache: "no-store",
        headers: etag ? { "If-None-Match": etag } : undefined,
      });

      if (response.status === 304) return { exported: null, etag };

      return {
        exported: await jsonResponse<TicketExport>(response),
        etag: response.headers.get("ETag"),
      };
    },
    health: (signal?: AbortSignal) => request<Health>("/health", { signal }),
    auth: (signal?: AbortSignal) => request<AuthState>("/auth/me", { signal }),
    signInUrl: `${base}/auth/login`,
    signOut: () => request<unknown>("/auth/logout", { method: "POST" }),
    sync: () => request<unknown>("/sync", { method: "POST" }),
    /** Files a ticket the Core writes in Jira; the Core then classifies it like any other. */
    demoTicket: () =>
      request<{ key: string; warnings: string[] }>("/demo/tickets", { method: "POST" }),
    patch: (patches: TicketPatch[], user: SignedInUser | null) =>
      request<PatchResponse>("/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Atlassian-Account-Id": user?.accountId ?? "shared",
        },
        body: JSON.stringify(patches),
      }),
    /**
     * Core proposals and runs by Jira key, from one request: the list expanded with each
     * ticket's view. Null when the backend has no Core configured.
     */
    coreState: async (
      signal?: AbortSignal,
      previous?: CoreState | null,
    ): Promise<CoreState | null> => {
      let summaries: CoreTicketSummary[];

      try {
        if (
          previous?.signature &&
          previous.expandedAt &&
          Date.now() - previous.expandedAt < 60_000
        ) {
          const compact = (
            await request<{ tickets: CoreTicketSummary[] }>("/core/tickets", { signal })
          ).tickets;

          if (JSON.stringify(compact) === previous.signature) return previous;
        }

        summaries = (
          await request<{ tickets: CoreTicketSummary[] }>("/core/tickets?expand=view", { signal })
        ).tickets;
      } catch (failure) {
        if (failure instanceof HttpError && failure.status === 503) return null;

        throw failure;
      }

      return {
        signature: JSON.stringify(summaries.map(({ view: _view, ...summary }) => summary)),
        expandedAt: Date.now(),
        proposals: new Map(
          summaries.flatMap((summary) => {
            const proposal = summary.view ? coreProposal(summary.view, summary.risk ?? null) : null;

            return proposal ? [[summary.external_key, proposal] as const] : [];
          }),
        ),
        runs: new Map(summaries.map((summary) => [summary.external_key, summary.run_status])),
      };
    },
    coreOverride: (core: NonNullable<Proposal["core"]>, changes: CoreChange[], actor: string) =>
      request<unknown>(`/core/tickets/${encodeURIComponent(core.ticket_id)}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_run_id: core.run_id, actor, changes }),
      }),
    coreAccept: (core: NonNullable<Proposal["core"]>, fields: string[], actor: string) =>
      request<unknown>(`/core/tickets/${encodeURIComponent(core.ticket_id)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: core.run_id, actor, fields }),
      }),
  };
}

function explanation(decision: CoreDecision): Explanation {
  const evidence = [
    ...(decision.rule_trace ? [decision.rule_trace] : []),
    ...decision.evidence.ticket_spans.map((span) => `${span.field}: "${span.text}"`),
    ...decision.evidence.patterns
      .slice(0, 3)
      .map(
        (pattern) =>
          `Similar past tickets (${Math.round(pattern.similarity * 100)}%): ${pattern.service}, resolved by ${pattern.resolver}`,
      ),
    ...(decision.flags.length ? [`Flags: ${decision.flags.join(", ")}`] : []),
  ];

  return {
    reason: decision.pinned ? `Operator override. ${decision.reason}` : decision.reason,
    confidence: decision.pinned ? null : decision.confidence,
    evidence,
    source: decision.source,
    signals: decision.confidence_signals,
    ticketSpans: decision.evidence.ticket_spans,
    patterns: decision.evidence.patterns,
    serviceCard: decision.evidence.service_card,
    flags: decision.flags,
    pinned: decision.pinned,
  };
}

/** The Core's effective state (AI decisions plus human overrides) as a dashboard proposal. */
export function coreProposal(view: CoreTicketView, risk: number | null = null): Proposal | null {
  const state = view.effective_state;
  const run = view.latest_run;

  if (!state || !run || !view.lane) return null;
  const value = (field: string) => state[field]?.effective_value ?? null;
  const workType = value("work_type");
  const service = value("service");
  const urgency = levelOf(value("urgency"));
  const impact = levelOf(value("impact"));
  const resolution = RESOLUTIONS.find((item) => item === value("resolution"));

  if (!workType || !service || !urgency || !impact || !resolution) return null;

  const assignees = [
    value("assignee"),
    ...(state.assignee?.alternatives ?? []).map((a) => a.value),
  ];

  // The Core writes "<assignee>: Resolution: …"; the dashboard adds the assignee when posting.
  const comment = view.resolution_comment?.text.replace(/^\S+: (?=Resolution: )/, "") ?? "";

  const explanations: Proposal["explanations"] = {};

  const acceptedFields = new Set(
    (view.history ?? [])
      .filter((entry) => entry.type === "acceptance" && entry.run_id === run.run_id)
      .flatMap((entry) => entry.fields ?? []),
  );

  const decisionFields: DecisionField[] = [...TRIAGE_FIELDS, "team", "priority", "resolution"];

  for (const field of decisionFields) {
    const decision = state[field];

    if (decision) explanations[field] = explanation(decision);
  }

  return {
    ticket_id: view.external_key,
    model_id: run.versions.model,
    classified_at: run.completed_at,
    proposal: {
      work_type: workType,
      service,
      assignee_candidates: [...new Set(assignees)].flatMap((email) =>
        email ? [{ email, historical_count: 0 }] : [],
      ),
      urgency,
      impact,
      resolution,
      resolution_comment: comment,
    },
    rationale: state.service?.reason ?? "",
    review_flags: [
      ...new Set([
        ...Object.values(state).flatMap((decision) => decision.flags),
        ...(view.resolution_comment?.stale ? ["stale_comment"] : []),
      ]),
    ],
    explanations,
    core: {
      ticket_id: view.ticket_id,
      run_id: run.run_id,
      lane: view.lane,
      lane_reasons: view.lane_reasons,
      risk,
      audit_sampled: run.audit_sampled,
      acceptedFields: TRIAGE_FIELDS.filter((field) => acceptedFields.has(field)),
      versions: run.versions,
      comment: view.resolution_comment
        ? {
            segments: view.resolution_comment.segments,
            exemplarPatternIds: view.resolution_comment.exemplar_pattern_ids,
            unsupportedSpecifics: view.resolution_comment.unsupported_specifics,
            stale: view.resolution_comment.stale,
          }
        : null,
    },
  };
}

export function levelOf(value: string | null): Level | null {
  return LEVELS.find((level) => level.toLowerCase() === value?.toLowerCase()) ?? null;
}

export function ticketStatus(ticket: IncomingTicket): Status {
  // "Ask the reporter" closes the ticket in Jira with the Clarification resolution.
  if (ticket.Status === "done")
    return ticket.Resolution === "clarification" ? "waiting" : "resolved";

  if (ticket.Status === "in progress") return "in_progress";

  return ticket.Assignee ? "assigned" : "new";
}

export function ticketOutcome(ticket: IncomingTicket): Outcome {
  return OUTCOMES.find((outcome) => outcome === ticket.Resolution) ?? "done";
}

/** Send only edited fields, so a comment does not overwrite unrelated Jira changes. */
export function triagePatch(ticket: IncomingTicket, triage: Triage): TicketPatch {
  const previous = startingTriage(ticket, null);
  const patch: TicketPatch = { Key: ticket.Key };

  if (triage.work_type !== previous.work_type) patch["Work type"] = triage.work_type;

  if (triage.service !== previous.service)
    patch["Affected Business or IT Services"] = triage.service ? [triage.service] : [];

  // Team follows the service, also when Jira has the service but not its team yet.
  const team = serviceInfo(triage.service)?.[1];

  if (team && ticket["Service Team(s)"][0] !== team) patch["Service Team(s)"] = [team];

  if (triage.assignee !== previous.assignee) patch.Assignee = triage.assignee || null;

  if (triage.urgency !== previous.urgency) patch.Urgency = triage.urgency;

  if (triage.impact !== previous.impact) patch.Impact = triage.impact;

  return patch;
}

/** Aggregate only records read from the backend, with the Core's proposals when there are any. */
export function liveBundle(
  exported: TicketExport,
  proposals: ReadonlyMap<string, Proposal> = new Map(),
): Bundle {
  const challenge = exported.records.map((ticket) => ({
    ...ticket,
    Urgency: levelOf(ticket.Urgency),
    Impact: levelOf(ticket.Impact),
  }));

  const status: Record<string, number> = {};
  const resolution: Record<string, number> = {};
  const workType: Record<string, number> = {};
  const service: Record<string, number> = {};
  const team: Record<string, number> = {};
  const weekly = new Map<string, number>();
  const dates: string[] = [];

  for (const ticket of challenge) {
    status[ticket.Status] = (status[ticket.Status] ?? 0) + 1;
    workType[ticket["Work type"]] = (workType[ticket["Work type"]] ?? 0) + 1;

    if (ticket.Status === "done" && ticket.Resolution)
      resolution[ticket.Resolution] = (resolution[ticket.Resolution] ?? 0) + 1;

    for (const name of ticket["Affected Business or IT Services"])
      service[name] = (service[name] ?? 0) + 1;

    for (const name of ticket["Service Team(s)"]) team[name] = (team[name] ?? 0) + 1;
    const day = ticket["Created date"]?.slice(0, 10);

    if (!day) continue;
    const date = new Date(`${day}T00:00:00Z`);

    if (Number.isNaN(date.getTime())) continue;
    dates.push(day);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    weekly.set(week, (weekly.get(week) ?? 0) + 1);
  }

  dates.sort();
  const first = dates[0] ?? "";
  const last = dates.at(-1) ?? "";

  const weeks = [...weekly]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([week, count]) => {
      const end = new Date(`${week}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);

      return week >= first && end.toISOString().slice(0, 10) <= last ? [{ week, count }] : [];
    });

  return {
    historical: {
      total: challenge.length,
      status,
      resolution,
      work_type: workType,
      generic_bucket: service["Emailed Support Tickets"] ?? 0,
      service,
      team,
      first_day: first,
      last_day: last,
      days: first ? Math.max(1, (Date.parse(last) - Date.parse(first)) / 86_400_000 + 1) : 1,
      weekly: weeks,
    },
    challenge,
    proposals: challenge.map((ticket) => proposals.get(ticket.Key) ?? null),
    proposal_source: { kind: proposals.size ? "core" : "none", path: null },
    similar: {},
    historical_examples: {},
    assignees: [
      ...new Set(challenge.flatMap((ticket) => (ticket.Assignee ? [ticket.Assignee] : []))),
    ].sort(),
  };
}

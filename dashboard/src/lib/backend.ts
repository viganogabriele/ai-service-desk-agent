import { LEVELS, OUTCOMES, serviceInfo, startingTriage } from "../domain.ts";
import type {
  Bundle,
  IncomingTicket,
  Level,
  Outcome,
  Resolution,
  Status,
  Ticket,
  Triage,
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

interface ApiError {
  error?: { message?: string };
}

export function createBackendClient(baseUrl: string, fetcher = fetch) {
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${base}${path}`, init);

    if (!response.ok) {
      const payload: ApiError = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
    }

    return response.json();
  }

  return {
    tickets: (signal?: AbortSignal) => request<TicketExport>("/tickets", { signal }),
    health: (signal?: AbortSignal) => request<Health>("/health", { signal }),
    sync: () => request<unknown>("/sync", { method: "POST" }),
    patch: (patches: TicketPatch[]) =>
      request<PatchResponse>("/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patches),
      }),
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

  if (triage.service !== previous.service) {
    patch["Affected Business or IT Services"] = triage.service ? [triage.service] : [];
    const team = serviceInfo(triage.service)?.[1];

    if (team) patch["Service Team(s)"] = [team];
  }

  if (triage.assignee !== previous.assignee) patch.Assignee = triage.assignee || null;

  if (triage.urgency !== previous.urgency) patch.Urgency = triage.urgency;

  if (triage.impact !== previous.impact) patch.Impact = triage.impact;

  return patch;
}

/** Aggregate only records read from the backend; no challenge files or AI proposals. */
export function liveBundle(exported: TicketExport): Bundle {
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
    proposals: challenge.map(() => null),
    proposal_source: { kind: "none", path: null },
    similar: {},
    historical_examples: {},
    assignees: [
      ...new Set(challenge.flatMap((ticket) => (ticket.Assignee ? [ticket.Assignee] : []))),
    ].sort(),
  };
}

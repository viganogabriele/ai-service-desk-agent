import type { Tone } from "./components/ui/badge";

export const SERVICES = [
  ["Trading Platform", "Investment Operations", "Critical"],
  ["Trade Matching", "Investment Operations", "Critical"],
  ["Portfolio Accounting", "Investment Operations", "Critical"],
  ["Order Management", "Trading Support", "Critical"],
  ["Securities Settlement", "Securities Operations", "Critical"],
  ["Corporate Actions", "Securities Operations", "Critical"],
  ["Fund Pricing", "Valuation & Pricing", "Critical"],
  ["NAV Calculation", "Valuation & Pricing", "Critical"],
  ["Cash Management", "Treasury & Cash", "Critical"],
  ["Risk & Compliance Monitoring", "Risk & Controls", "Critical"],
  ["Regulatory Reporting", "Risk & Controls", "Critical"],
  ["SimCorp Dimension", "Enterprise Applications", "Critical"],
  ["Rimes Data Feed", "Market Data Services", "Critical"],
  ["Client Reporting", "Client Services", "Critical"],
  ["Tax Reporting", "Tax & Reporting", "Non-Critical"],
  ["CRM & Client Portal", "Client Services", "Non-Critical"],
  ["Identity & Access Management", "Enterprise Applications", "Non-Critical"],
  ["SharePoint & File Storage", "Enterprise Applications", "Non-Critical"],
  ["Outlook & Email", "Enterprise Applications", "Non-Critical"],
  ["Emailed Support Tickets", "Service Desk", "Non-Critical"],
] as const;

export const LEVELS = ["Highest", "High", "Medium", "Low", "Lowest"] as const;

export type Level = (typeof LEVELS)[number];

export const URGENCY_LABELS = ["Critical", "High", "Medium", "Low", "Lowest"];

export const IMPACT_LABELS = [
  "Major / Widespread",
  "Significant / Large",
  "Moderate / Limited",
  "Minor / Localized",
  "No direct impact / Information",
];

export const PRIORITY_MATRIX: readonly (readonly Level[])[] = [
  ["Highest", "Highest", "High", "Medium", "Medium"],
  ["Highest", "High", "High", "Medium", "Low"],
  ["High", "High", "Medium", "Low", "Low"],
  ["Medium", "Medium", "Low", "Low", "Lowest"],
  ["Medium", "Low", "Low", "Lowest", "Lowest"],
];

export const RESOLUTIONS = ["done", "cancelled", "clarification", "cannot reproduce"] as const;

export type Resolution = (typeof RESOLUTIONS)[number];

// Workflow states of an incoming ticket in this desk. They map onto Jira fields at export.
export const STATUSES = ["new", "in_progress", "assigned", "waiting", "resolved"] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "Awaiting review",
  in_progress: "In progress",
  assigned: "Assigned",
  waiting: "Waiting for reporter",
  resolved: "Resolved",
};

export const STATUS_HELP: Record<Status, string> = {
  new: "Not yet reviewed by an operator",
  in_progress: "Triage edited but not yet assigned or resolved",
  assigned: "Routed to the service team; still open",
  waiting: "A question was sent to the reporter",
  resolved: "Closed with a resolution note",
};

export const STATUS_DOTS: Record<Status, Tone> = {
  new: "muted",
  in_progress: "foreground",
  assigned: "info",
  waiting: "warning",
  resolved: "success",
};

export const OPEN_STATUSES: readonly Status[] = ["new", "in_progress", "assigned"];

// Outcomes an operator can close a ticket with; "clarification" is set by asking the reporter.
export const OUTCOMES = ["done", "cancelled", "cannot reproduce"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  done: "Fixed",
  cancelled: "Cancelled",
  "cannot reproduce": "Cannot reproduce",
};

export const PRIORITY_DOTS: Record<Level, string> = {
  Highest: "red",
  High: "amber",
  Medium: "secondary",
  Low: "",
  Lowest: "",
};

export function serviceInfo(name: string) {
  return SERVICES.find((row) => row[0].toLowerCase() === name.toLowerCase());
}

export function priority(urgency: Level | null, impact: Level | null): Level | null {
  if (!urgency || !impact) return null;

  return PRIORITY_MATRIX[LEVELS.indexOf(urgency)][LEVELS.indexOf(impact)];
}

export interface Ticket {
  Key: string;
  "Work type": string;
  "Request type": string | null;
  Summary: string;
  Description: string;
  "Affected Business or IT Services": string[];
  "Business Entity": string[];
  "Service Team(s)": string[];
  Reporter: string | null;
  Assignee: string | null;
  Priority: string | null;
  Urgency: string | null;
  Impact: string | null;
  "Created date": string | null;
  Status: string;
  "Linked issues": string[];
  Resolution: string | null;
  "Due date": string | null;
  "Resolution date"?: string | null;
  "All Comments": string[];
}

/** Incoming tickets; urgency and impact are validated against LEVELS during data preparation. */
export interface IncomingTicket extends Omit<Ticket, "Urgency" | "Impact"> {
  Urgency: Level | null;
  Impact: Level | null;
}

export interface Triage {
  work_type: string;
  service: string;
  assignee: string;
  urgency: Level | null;
  impact: Level | null;
  /** The priority Jira holds, for tickets without urgency or impact. */
  priority: Level | null;
}

export const TRIAGE_FIELDS = ["work_type", "service", "assignee", "urgency", "impact"] as const;

export const FIELD_LABELS: Record<(typeof TRIAGE_FIELDS)[number], string> = {
  work_type: "Work type",
  service: "Service",
  assignee: "Assignee",
  urgency: "Urgency",
  impact: "Impact",
};

export type TriageField = (typeof TRIAGE_FIELDS)[number];

/**
 * Why the model chose one value. A §3.1 proposal file may carry one per field; without it the
 * ticket page derives a note from the proposal itself (reason, declared values, assignee support).
 */
export interface Explanation {
  reason: string;
  confidence: number | null;
  evidence: string[];
}

export interface Proposal {
  ticket_id: string;
  model_id: string;
  latency_ms?: number | null;
  cost_chf?: number | null;
  proposal: {
    work_type: string;
    service: string;
    assignee_candidates: { email: string; historical_count: number; support?: number }[];
    urgency: Level;
    impact: Level;
    resolution: Resolution;
    resolution_comment: string;
  };
  rationale: string;
  review_flags: string[];
  // Service or product names the solver found in the ticket text.
  content_clues?: string[];
  explanations?: Partial<Record<TriageField | "resolution_comment", Explanation>>;
  // The Core run this proposal comes from; accepts and overrides are recorded against it.
  core?: { ticket_id: string; run_id: string };
}

export interface SimilarResolution {
  historical_index: number;
  summary: string;
  service: string;
  resolution_date: string | null;
  resolution_text: string;
  times_used: number;
  similarity: number;
}

export interface Bundle {
  historical: {
    total: number;
    status: Record<string, number>;
    resolution: Record<string, number>;
    work_type: Record<string, number>;
    generic_bucket: number;
    service: Record<string, number>;
    team: Record<string, number>;
    first_day: string;
    last_day: string;
    days: number;
    weekly: { week: string; count: number }[];
  };
  challenge: IncomingTicket[];
  proposals: (Proposal | null)[];
  proposal_source: { kind: "file" | "solver_output" | "core" | "none"; path: string | null };
  similar: Record<string, SimilarResolution[]>;
  assignees: string[];
  historical_examples: Record<string, Ticket>;
}

/** Starting triage: the AI proposal when one exists, otherwise what the reporter declared. */
export function startingTriage(ticket: IncomingTicket, proposal: Proposal | null): Triage {
  if (proposal)
    return {
      work_type: proposal.proposal.work_type,
      service: proposal.proposal.service,
      assignee: proposal.proposal.assignee_candidates[0]?.email ?? "",
      urgency: proposal.proposal.urgency,
      impact: proposal.proposal.impact,
      priority: priority(proposal.proposal.urgency, proposal.proposal.impact),
    };

  return {
    work_type: ticket["Work type"],
    service: ticket["Affected Business or IT Services"][0] ?? "",
    assignee: ticket.Assignee ?? "",
    urgency: ticket.Urgency,
    impact: ticket.Impact,
    priority: LEVELS.find((value) => value === ticket.Priority) ?? null,
  };
}

export function fieldLabel(field: string) {
  const known = TRIAGE_FIELDS.find((item) => item === field);

  return known ? FIELD_LABELS[known] : field;
}

export function aiValue(proposal: Proposal | null, field: (typeof TRIAGE_FIELDS)[number]) {
  if (!proposal) return null;

  if (field === "assignee") return proposal.proposal.assignee_candidates[0]?.email ?? null;

  return proposal.proposal[field];
}

export function triageChanges(triage: Triage, baseline: Triage) {
  return TRIAGE_FIELDS.flatMap((field) =>
    triage[field] === baseline[field]
      ? []
      : [{ field, before: baseline[field], after: triage[field] }],
  );
}

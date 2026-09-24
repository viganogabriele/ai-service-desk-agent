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

export type ReviewStatus =
  | "to_process"
  | "proposed"
  | "in_review"
  | "accepted"
  | "modified_accepted"
  | "escalated"
  | "clarification_requested";

export const COMPLETED_STATUSES: readonly ReviewStatus[] = [
  "accepted",
  "modified_accepted",
  "escalated",
  "clarification_requested",
];

export function serviceInfo(name: string) {
  return SERVICES.find((row) => row[0].toLowerCase() === name.toLowerCase());
}

export function priority(urgency: Level, impact: Level): Level {
  return PRIORITY_MATRIX[LEVELS.indexOf(urgency)][LEVELS.indexOf(impact)];
}

export interface Ticket {
  "Work type": string;
  "Request type": string;
  Summary: string;
  Description: string;
  "Affected Business or IT Services": string[];
  "Business Entity": string[];
  "Service Team(s)": string[];
  Reporter: string;
  Assignee: string | null;
  Priority: string;
  Urgency: string;
  Impact: string;
  "Created date": string;
  Status: string;
  "Linked issues": string[];
  Resolution: string | null;
  "Due date": string | null;
  "All Comments": string[];
}

export interface FormValues {
  work_type: string;
  service: string;
  assignee: string;
  urgency: Level;
  impact: Level;
  resolution: Resolution;
  resolution_comment: string;
}

export interface Proposal {
  ticket_id: string;
  model_id: string;
  generated_at?: string;
  latency_ms?: number | null;
  cost_chf?: number | null;
  proposal: Omit<FormValues, "assignee"> & {
    assignee_candidates: { email: string; historical_count: number }[];
  };
  confidence: { work_type: number | null; service: number | null };
  rationale: string;
  similar_tickets: {
    historical_index: number;
    summary: string;
    service: string;
    resolution: string;
    last_comment: string;
    similarity: number | null;
  }[];
}

export interface ModelMetrics {
  model_id: string;
  label: string;
  kind: "local" | "premium";
  samples?: number;
  latency_ms_p50?: number | null;
  latency_ms_p95?: number | null;
  latency_ms_mean?: number | null;
  cost_chf_per_ticket?: number | null;
  cost_note?: string;
  holdout?: {
    n: number;
    label?: string;
    accuracy: { service?: number; work_type?: number; team?: number };
  } | null;
}

export interface Bundle {
  mock: boolean;
  historical: {
    total: number;
    status: Record<string, number>;
    resolution: Record<string, number>;
    work_type: Record<string, number>;
    generic_bucket: number;
    service: Record<string, number>;
    team: Record<string, number>;
    entity: Record<string, number>;
    first_day: string;
    last_day: string;
    days: number;
    weekly: { week: string; count: number }[];
    heatmap: number[][];
  };
  models: ModelMetrics[];
  models_source: "file" | "dev_run" | "none";
  challenge: Ticket[];
  proposals: Proposal[];
  assignees: string[];
  historical_examples: Record<string, Ticket>;
}

export function startingForm(proposal: Proposal): FormValues {
  return {
    work_type: proposal.proposal.work_type,
    service: proposal.proposal.service,
    assignee: proposal.proposal.assignee_candidates[0]?.email ?? "",
    urgency: proposal.proposal.urgency,
    impact: proposal.proposal.impact,
    resolution: proposal.proposal.resolution,
    resolution_comment: proposal.proposal.resolution_comment,
  };
}

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  to_process: "To process",
  proposed: "Proposed",
  in_review: "In review",
  accepted: "Accepted",
  modified_accepted: "Modified",
  escalated: "Escalated",
  clarification_requested: "Clarification",
};

export const STATUS_DOTS: Record<ReviewStatus, Tone> = {
  to_process: "muted",
  proposed: "secondary",
  in_review: "foreground",
  accepted: "success",
  modified_accepted: "success",
  escalated: "warning",
  clarification_requested: "info",
};

export const PRIORITY_DOTS: Record<Level, Tone> = {
  Highest: "danger",
  High: "warning",
  Medium: "secondary",
  Low: "muted",
  Lowest: "muted",
};

export const ESCALATION_REASONS = [
  "Uncertain service",
  "Insufficient information",
  "Possible critical incident",
  "Other",
] as const;

export function confidenceLabel(value: number | null) {
  if (value === null) return "Not measured";

  return value >= 0.8 ? "High" : value >= 0.5 ? "Medium" : "Low";
}

export function commentBody(comment: string) {
  return comment.split(":").slice(1).join(":").trim();
}

export function formChanges(form: FormValues, baseline: FormValues) {
  // SAFETY: all own keys of FormValues are declared string-valued fields.
  return (Object.keys(form) as (keyof FormValues)[]).flatMap((field) =>
    form[field] === baseline[field] ? [] : [{ field, before: baseline[field], after: form[field] }],
  );
}

export function reviewWarnings(ticket: Ticket, form: FormValues) {
  const rating = serviceInfo(form.service)?.[2];
  const level = priority(form.urgency, form.impact);
  const body = commentBody(form.resolution_comment);

  return [
    rating === "Critical" && ["Low", "Lowest"].includes(level)
      ? "Critical service with low priority"
      : "",
    body.length < 40 || /^(fixed|problem fixed|resolution recorded)$/i.test(body)
      ? "Resolution comment needs more detail"
      : "",
    ticket["Request type"] === "Nonsense / Unclear Input" && form.resolution !== "clarification"
      ? "Unclear input should request clarification"
      : "",
    !form.assignee ? "Assignee is empty" : "",
  ].filter(Boolean);
}

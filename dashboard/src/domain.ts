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
  proposal: Omit<FormValues, "assignee"> & {
    assignee_candidates: { email: string; historical_count: number }[];
  };
  confidence: { work_type: number; service: number };
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

export interface Bundle {
  mock: boolean;
  historical: {
    total: number;
    status: Record<string, number>;
    resolution: Record<string, number>;
    work_type: Record<string, number>;
    generic_bucket: number;
  };
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

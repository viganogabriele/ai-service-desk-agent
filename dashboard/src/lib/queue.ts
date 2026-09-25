import { LEVELS, TRIAGE_FIELDS, serviceInfo, triageLevel } from "../domain.ts";
import type { IncomingTicket, Proposal, Status, Triage, TriageField } from "../domain.ts";
import { parseComment } from "./backend.ts";
import type { Classification } from "./backend.ts";

/** What the Priority View needs to know about a ticket. */
export interface QueueItem {
  ticket: IncomingTicket;
  proposal: Proposal | null;
  current: { status: Status; triage: Triage; verified?: readonly string[] };
  classification: Classification | null;
}

/**
 * Where a ticket is, from the operator's side. `reply` is a waiting ticket the reporter has
 * answered; `unclassified` is one to triage without an AI suggestion.
 */
export type Stage =
  | "reply"
  | "in_progress"
  | "review"
  | "unclassified"
  | "assigned"
  | "waiting"
  | "resolved";

// How far along a ticket is. Among tickets of one priority, the furthest along goes first.
const TRACTION: Partial<Record<Stage, number>> = { reply: 2, in_progress: 1 };

/** How many tickets "Most recent" shows; the table below has the rest. */
export const RECENT_LIMIT = 12;

/** The reporter's answer to the last question an operator asked, if one arrived since. */
export function reporterReply(ticket: IncomingTicket) {
  const comments = ticket["All Comments"].map(parseComment);

  // Operators sign their comments; the reporter's replies come from Jira unsigned or as the reporter.
  const byReporter = (author: string | null) => author === null || author === ticket.Reporter;
  const asked = comments.findLastIndex((comment) => !byReporter(comment.author));

  if (asked === -1) return null;

  return (
    comments
      .slice(asked + 1)
      .findLast((comment) => byReporter(comment.author) && comment.text)
      ?.text.trim() ?? null
  );
}

/** The last question sent to the reporter, for a ticket that is waiting for them. */
export function lastQuestion(ticket: IncomingTicket) {
  return (
    ticket["All Comments"]
      .map(parseComment)
      .findLast((comment) => comment.author !== null && comment.author !== ticket.Reporter)
      ?.text.trim() ?? null
  );
}

export function stageOf(item: QueueItem): Stage {
  const { status } = item.current;

  if (status === "waiting") return reporterReply(item.ticket) ? "reply" : "waiting";

  if (status === "resolved" || status === "assigned" || status === "in_progress") return status;

  return item.proposal ? "review" : "unclassified";
}

/** Triage fields the operator has confirmed, out of all of them. */
export function confirmedFields(item: QueueItem) {
  const verified = item.current.verified ?? [];

  return TRIAGE_FIELDS.filter((field) => verified.includes(field)).length;
}

// Below this the Core sends a field to review (FIELD_THRESHOLDS in core/triage/config.py).
const REVIEW_THRESHOLD = 0.6;

/** The AI field it was least sure of, when the Core would ask for a check on it. */
export function leastConfident(proposal: Proposal | null): TriageField | null {
  let lowest: { field: TriageField; confidence: number } | null = null;

  for (const field of TRIAGE_FIELDS) {
    const confidence = proposal?.explanations?.[field]?.confidence;

    if (
      confidence !== undefined &&
      confidence !== null &&
      confidence < (lowest?.confidence ?? REVIEW_THRESHOLD)
    )
      lowest = { field, confidence };
  }

  return lowest?.field ?? null;
}

const isCritical = (item: QueueItem) =>
  serviceInfo(item.current.triage.service)?.[2] === "Critical";

/**
 * Tickets the operator should pick up now: every reply and every started triage, every ticket the
 * AI could not classify or left to a human, and the rest of the untouched ones when they are high
 * priority, or medium on a critical service.
 */
export function needsAttention(item: QueueItem) {
  if (item.classification === "queued" || item.classification === "classifying") return false;
  const stage = stageOf(item);

  if (stage === "reply" || stage === "in_progress") return true;

  if (stage !== "review" && stage !== "unclassified") return false;

  if (item.classification === "failed" || item.proposal?.core?.lane === "human_only") return true;
  const level = triageLevel(item.current.triage);

  return level === "Highest" || level === "High" || (level === "Medium" && isCritical(item));
}

const DAY = 24 * 60 * 60 * 1000;

/** Epoch milliseconds of an ISO time or the export's local "YYYY-MM-DD HH:mm". */
export function timeOf(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value.replace(" ", "T")).getTime();

  return Number.isNaN(time) ? null : time;
}

/** Whole days since the ticket was created. */
export function ageInDays(item: QueueItem, now = Date.now()) {
  const created = timeOf(item.ticket["Created date"]);

  return created === null ? null : Math.max(0, Math.floor((now - created) / DAY));
}

const levelRank = (item: QueueItem) => {
  const level = triageLevel(item.current.triage);

  return level ? LEVELS.indexOf(level) : LEVELS.length;
};

/**
 * Priority first, so a Highest ticket is never behind a lower one. Within a priority: a reply,
 * then a started triage, then an untouched ticket; then critical services; then the oldest.
 */
export function byAttention(a: QueueItem, b: QueueItem) {
  return (
    levelRank(a) - levelRank(b) ||
    (TRACTION[stageOf(b)] ?? 0) - (TRACTION[stageOf(a)] ?? 0) ||
    Number(isCritical(b)) - Number(isCritical(a)) ||
    (timeOf(a.ticket["Created date"]) ?? Infinity) - (timeOf(b.ticket["Created date"]) ?? Infinity)
  );
}

/** When the ticket became available: when the AI finished it, else when it was opened. */
export const arrivedAt = (item: QueueItem) =>
  timeOf(item.proposal?.classified_at) ?? timeOf(item.ticket["Created date"]);

/** Newest first; tickets without a date go last. */
export function byRecency(a: QueueItem, b: QueueItem) {
  return (arrivedAt(b) ?? -Infinity) - (arrivedAt(a) ?? -Infinity);
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "12 minutes ago", "3 hours ago", "yesterday". */
export function timeAgo(time: number, now = Date.now()) {
  const minutes = Math.round((now - time) / 60_000);

  if (minutes < 1) return "just now";

  if (minutes < 60) return relative.format(-minutes, "minute");

  if (minutes < 60 * 24) return relative.format(-Math.round(minutes / 60), "hour");

  return relative.format(-Math.round(minutes / (60 * 24)), "day");
}

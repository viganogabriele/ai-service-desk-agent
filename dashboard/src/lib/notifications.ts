import { reporterReply, stageOf, timeOf } from "./queue.ts";
import type { QueueItem } from "./queue.ts";

/**
 * Something that happened to a ticket while the operator looked elsewhere: the reporter answered a
 * question, or the AI finished a ticket that was waiting for it.
 */
export interface TicketNotification {
  id: string;
  key: string;
  kind: "reply" | "classified";
  text: string;
  // When it happened; replies carry no time of their own in the Jira export.
  at: number | null;
}

export interface KeyedItem extends QueueItem {
  id: string;
}

// A short stable fingerprint, so a second reply on the same ticket is a new notification.
function fingerprint(text: string) {
  let hash = 5381;

  for (let position = 0; position < text.length; position++)
    hash = (hash * 33) ^ text.charCodeAt(position);

  return (hash >>> 0).toString(36);
}

/** One notification per reporter answer that waits for the operator. */
export function replyNotifications(items: readonly KeyedItem[]): TicketNotification[] {
  return items.flatMap((item) => {
    const reply = stageOf(item) === "reply" ? reporterReply(item.ticket) : null;

    return reply
      ? [
          {
            id: `reply:${item.id}:${fingerprint(reply)}`,
            key: item.id,
            kind: "reply" as const,
            text: reply,
            at: null,
          },
        ]
      : [];
  });
}

export const isPending = (item: QueueItem) =>
  item.classification === "queued" || item.classification === "classifying";

/** Tickets that were waiting for the AI and now have its suggestion, at the time the AI finished. */
export function classifiedSince(
  pending: ReadonlySet<string>,
  items: readonly KeyedItem[],
): TicketNotification[] {
  return items.flatMap((item) =>
    pending.has(item.id) && !isPending(item) && item.proposal
      ? [
          {
            id: `classified:${item.id}:${item.proposal.core?.run_id ?? item.proposal.classified_at}`,
            key: item.id,
            kind: "classified" as const,
            text: item.ticket.Summary,
            at: timeOf(item.proposal.classified_at),
          },
        ]
      : [],
  );
}

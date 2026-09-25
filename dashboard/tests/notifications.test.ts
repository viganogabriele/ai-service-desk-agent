import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingTicket, Proposal, Status } from "../src/domain.ts";
import { classifiedSince, replyNotifications } from "../src/lib/notifications.ts";
import type { KeyedItem } from "../src/lib/notifications.ts";

const REPORTER = "rita.reporter@intcom.com";
const QUESTION = "oscar.operator@intcom.com: Which environment?";

function item(
  id: string,
  status: Status,
  comments: string[],
  proposal: Proposal | null = null,
): KeyedItem {
  // Safety: the notification rules read only the key, reporter, summary and comments.
  const ticket = { Key: id, Reporter: REPORTER, Summary: `Ticket ${id}`, "All Comments": comments } as IncomingTicket;

  return {
    id,
    ticket,
    proposal,
    current: {
      status,
      triage: { work_type: "", service: "", assignee: "", urgency: null, impact: null, priority: null },
    },
    classification: null,
  };
}

test("each reporter answer is its own notification, and a question alone is none", () => {
  const first = replyNotifications([item("A", "waiting", [QUESTION, "Production."])]);
  const second = replyNotifications([item("A", "waiting", [QUESTION, "Production.", "Also staging."])]);

  assert.equal(first.length, 1);
  assert.equal(first[0].text, "Production.");
  assert.notEqual(first[0].id, second[0].id);
  assert.deepEqual(replyNotifications([item("B", "waiting", [QUESTION])]), []);
});

test("a ticket that leaves the AI's queue with a suggestion is announced at the AI's time", () => {
  // Safety: only the run and completion time of the proposal are read.
  const proposal = { core: { ticket_id: "c", run_id: "run-1" }, classified_at: "2026-09-25T10:00:00Z" } as Proposal;
  const done = item("A", "new", [], proposal);
  const still = { ...item("B", "new", []), classification: "classifying" as const };

  assert.deepEqual(classifiedSince(new Set(["A", "B"]), [done, still]), [
    {
      id: "classified:A:run-1",
      key: "A",
      kind: "classified",
      text: "Ticket A",
      at: Date.parse("2026-09-25T10:00:00Z"),
    },
  ]);
  assert.deepEqual(classifiedSince(new Set(), [done]), []);
});

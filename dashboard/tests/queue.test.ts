import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingTicket, Level, Proposal, Status } from "../src/domain.ts";
import { classificationOf } from "../src/lib/backend.ts";
import type { CoreState } from "../src/lib/backend.ts";
import { byAttention, needsAttention, reporterReply, stageOf } from "../src/lib/queue.ts";
import type { QueueItem } from "../src/lib/queue.ts";

const REPORTER = "rita.reporter@intcom.com";
const OPERATOR = "oscar.operator@intcom.com";

function ticket(key: string, comments: string[] = [], status = "open"): IncomingTicket {
  return {
    Key: key,
    "Work type": "Incident",
    "Request type": null,
    Summary: `Ticket ${key}`,
    Description: "",
    "Affected Business or IT Services": ["Tax Reporting"],
    "Business Entity": [],
    "Service Team(s)": [],
    Reporter: REPORTER,
    Assignee: null,
    Priority: null,
    Urgency: null,
    Impact: null,
    "Created date": "2026-09-20 09:00",
    Status: status,
    "Linked issues": [],
    Resolution: null,
    "Due date": null,
    "All Comments": comments,
  };
}

// Urgency and impact that give each priority on the matrix.
const LEVEL_INPUTS: Record<Level, [Level, Level]> = {
  Highest: ["Highest", "Highest"],
  High: ["High", "High"],
  Medium: ["Medium", "Medium"],
  Low: ["Low", "Low"],
  Lowest: ["Lowest", "Lowest"],
};

function item(
  key: string,
  { level = "High", status = "new", comments = [], service = "Tax Reporting" }: {
    level?: Level;
    status?: Status;
    comments?: string[];
    service?: string;
  } = {},
): QueueItem {
  const [urgency, impact] = LEVEL_INPUTS[level];

  return {
    ticket: ticket(key, comments),
    proposal: null,
    current: {
      status,
      triage: { work_type: "Incident", service, assignee: "", urgency, impact, priority: null },
    },
    classification: null,
  };
}

const replied = [`${OPERATOR}: Which environment?`, "Production, since this morning."];

test("a reporter's answer after an operator's question is a reply", () => {
  assert.equal(reporterReply(ticket("A", replied)), "Production, since this morning.");
  assert.equal(
    reporterReply(ticket("A", [`${OPERATOR}: Which environment?`, `${REPORTER}: Production.`])),
    "Production.",
  );
});

test("a question still unanswered, or only the reporter's own comments, is no reply", () => {
  assert.equal(reporterReply(ticket("A", [`${OPERATOR}: Which environment?`])), null);
  assert.equal(reporterReply(ticket("A", [`${REPORTER}: Some context.`])), null);
  assert.equal(
    reporterReply(ticket("A", [...replied, `${OPERATOR}: Thanks, one more thing?`])),
    null,
  );
});

test("only a waiting ticket turns into a reply", () => {
  assert.equal(stageOf(item("A", { status: "waiting", comments: replied })), "reply");
  assert.equal(stageOf(item("A", { status: "waiting" })), "waiting");
  assert.equal(stageOf(item("A", { status: "new", comments: replied })), "unclassified");
});

test("replies and started triage need attention at any priority; new tickets only when urgent", () => {
  assert.ok(needsAttention(item("A", { level: "Lowest", status: "waiting", comments: replied })));
  assert.ok(needsAttention(item("A", { level: "Lowest", status: "in_progress" })));
  assert.ok(needsAttention(item("A", { level: "High" })));
  assert.ok(needsAttention(item("A", { level: "Medium", service: "Trading Platform" })));
  assert.ok(!needsAttention(item("A", { level: "Medium" })));
  assert.ok(!needsAttention(item("A", { level: "High", status: "waiting" })));
  assert.ok(!needsAttention({ ...item("A", { level: "Highest" }), classification: "classifying" }));
  assert.ok(needsAttention({ ...item("A", { level: "Lowest" }), classification: "failed" }));
});

test("priority decides first, then how far along the ticket is", () => {
  const queue = [
    item("new-high"),
    item("reply-medium", { level: "Medium", status: "waiting", comments: replied }),
    item("started-high", { status: "in_progress" }),
    item("reply-high", { status: "waiting", comments: replied }),
    item("new-highest", { level: "Highest" }),
  ];

  assert.deepEqual(
    queue.sort(byAttention).map((entry) => entry.ticket.Key),
    ["new-highest", "reply-high", "started-high", "new-high", "reply-medium"],
  );
});

test("open tickets without a Core suggestion are queued, classifying or failed", () => {
  const core: CoreState = {
    // Safety: classificationOf only checks whether a proposal exists for the key.
    proposals: new Map([["DONE", { ticket_id: "DONE" } as Proposal]]),
    runs: new Map([
      ["DONE", "completed"],
      ["RUN", "running"],
      ["WAIT", "queued"],
      ["BAD", "failed"],
    ]),
  };

  assert.equal(classificationOf(ticket("DONE"), core), null);
  assert.equal(classificationOf(ticket("RUN"), core), "classifying");
  assert.equal(classificationOf(ticket("WAIT"), core), "queued");
  assert.equal(classificationOf(ticket("BAD"), core), "failed");
  // Synced from Jira, not yet sent to the Core.
  assert.equal(classificationOf(ticket("NEW"), core), "queued");
  // Closed tickets are never triaged, and without a Core nothing is pending.
  assert.equal(classificationOf(ticket("NEW", [], "done"), core), null);
  assert.equal(classificationOf(ticket("NEW"), null), null);
});

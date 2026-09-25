import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HttpError,
  UNREACHABLE,
  createBackendClient,
  coreProposal,
  parseComment,
  signedComment,
} from "../src/lib/backend.ts";

const user = { accountId: "a1", name: "Maria Rossi", email: "maria.rossi@intcom.com" };

test("cross-origin auth, writes and logout include the session cookie", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const backend = createBackendClient("http://localhost:8787", async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return Response.json({});
  });
  await backend.auth();
  await backend.patch([{ Key: "SUP-1", Urgency: "High" }], user);
  await backend.signOut();
  assert.equal(requests.length, 3);
  for (const { init } of requests) assert.equal(init.credentials, "include");
  const write = requests[1];
  assert.equal(new Headers(write.init.headers).get("X-Atlassian-Account-Id"), "a1");
  assert.equal(write.url, "http://localhost:8787/tickets");
});

test("ticket refresh reuses the cached export on a 304", async () => {
  const headers: (string | null)[] = [];
  const backend = createBackendClient("/api", async (_url, init) => {
    headers.push(new Headers(init?.headers).get("If-None-Match"));

    return headers.length === 1
      ? Response.json(
          { records: [], actualIssueCount: 0, jql: "", fetchedAtUtc: "" },
          {
            headers: { ETag: '"v1"' },
          },
        )
      : new Response(null, { status: 304, headers: { ETag: '"v1"' } });
  });

  const first = await backend.tickets();
  const second = await backend.tickets(undefined, first.etag ?? undefined);
  assert.deepEqual(headers, [null, '"v1"']);
  assert.equal(first.exported?.actualIssueCount, 0);
  assert.deepEqual(second, { exported: null, etag: '"v1"' });
});

test("Core proposals preserve decision evidence, risk and approvals from the latest run", () => {
  const decision = (value: string) => ({
    effective_value: value,
    source: "ai_judgment" as const,
    confidence: 0.73,
    confidence_signals: { retrieval_similarity: 0.81 },
    reason: "Matched the reported service.",
    rule_trace: null,
    evidence: {
      ticket_spans: [{ field: "Description", start: 0, end: 7, text: "Trading" }],
      patterns: [
        { pattern_id: "P1", similarity: 0.88, service: "Trading Platform", resolver: "a@b.com" },
      ],
      service_card: "Trading Platform",
    },
    alternatives: [],
    flags: ["service_changed"],
    pinned: false,
  });
  const view = {
    ticket_id: "c-1",
    external_key: "SUP-1",
    effective_state: {
      work_type: decision("Incident"),
      service: decision("Trading Platform"),
      team: decision("Investment Operations"),
      assignee: decision("a@b.com"),
      urgency: decision("High"),
      impact: decision("High"),
      priority: decision("High"),
      resolution: decision("done"),
    },
    latest_run: { run_id: "run-2", versions: { model: "test-model" }, audit_sampled: false },
    resolution_comment: {
      text: "a@b.com: Resolution: Service restored.",
      stale: true,
      segments: [{ text: "Resolution: Service restored.", origin: "generated" as const }],
      exemplar_pattern_ids: ["P1"],
      unsupported_specifics: ["Service restored"],
    },
    lane: "needs_review" as const,
    lane_reasons: ["service_changed"],
    history: [
      { type: "acceptance", run_id: "run-1", fields: ["service"] },
      { type: "acceptance", run_id: "run-2", fields: ["work_type", "urgency"] },
    ],
  };
  const proposal = coreProposal(view, 1.42);
  assert.ok(proposal);
  assert.deepEqual(proposal.core?.acceptedFields, ["work_type", "urgency"]);
  assert.equal(proposal.core?.risk, 1.42);
  assert.equal(proposal.core?.comment?.stale, true);
  assert.deepEqual(proposal.core?.comment?.unsupportedSpecifics, ["Service restored"]);
  assert.equal(proposal.explanations?.service?.source, "ai_judgment");
  assert.deepEqual(proposal.explanations?.service?.ticketSpans, [
    { field: "Description", start: 0, end: 7, text: "Trading" },
  ]);
  assert.equal(proposal.explanations?.priority?.confidence, 0.73);
});

test("the Core state is read in one expanded request, not one per ticket", async () => {
  const requests: string[] = [];
  let risk = 0.3;
  const decision = (value: string) => ({
    effective_value: value,
    source: "rule" as const,
    confidence: 1,
    confidence_signals: {},
    reason: "Looked up.",
    rule_trace: null,
    evidence: { ticket_spans: [], patterns: [], service_card: null },
    alternatives: [],
    flags: [],
    pinned: false,
  });
  const view = {
    ticket_id: "c-1",
    external_key: "SUP-1",
    effective_state: {
      work_type: decision("Incident"),
      service: decision("Trading Platform"),
      team: decision("Investment Operations"),
      assignee: decision("a@b.com"),
      urgency: decision("High"),
      impact: decision("High"),
      priority: decision("High"),
      resolution: decision("done"),
    },
    latest_run: {
      run_id: "run-1",
      versions: { model: "m" },
      audit_sampled: false,
      completed_at: null,
    },
    resolution_comment: null,
    lane: "needs_review" as const,
    lane_reasons: [],
  };
  const backend = createBackendClient("/api", async (url) => {
    requests.push(String(url));
    const expanded = String(url).includes("expand=view");

    return Response.json({
      tickets: [
        {
          ticket_id: "c-1",
          external_key: "SUP-1",
          lane: "needs_review",
          risk,
          run_status: "completed",
          ...(expanded ? { view } : {}),
        },
        {
          ticket_id: "c-2",
          external_key: "SUP-2",
          lane: null,
          run_status: "queued",
          ...(expanded ? { view: null } : {}),
        },
      ],
    });
  });
  const state = await backend.coreState();
  assert.deepEqual(requests, ["/api/core/tickets?expand=view"]);
  assert.ok(state);
  assert.deepEqual([...state.proposals.keys()], ["SUP-1"]);
  assert.equal(state.proposals.get("SUP-1")?.core?.risk, 0.3);
  assert.deepEqual(
    [...state.runs],
    [
      ["SUP-1", "completed"],
      ["SUP-2", "queued"],
    ],
  );
  assert.equal(await backend.coreState(undefined, state), state);
  assert.deepEqual(requests, ["/api/core/tickets?expand=view", "/api/core/tickets"]);

  risk = 0.4;
  const changed = await backend.coreState(undefined, state);
  assert.equal(changed?.proposals.get("SUP-1")?.core?.risk, 0.4);
  assert.deepEqual(requests.slice(-2), ["/api/core/tickets", "/api/core/tickets?expand=view"]);
});

test("approving a Core suggestion records the field against its run", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const backend = createBackendClient("/api", async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return Response.json({ acceptance_id: "a-1" });
  });
  const core = { ticket_id: "c-1", run_id: "run-2" } as Parameters<typeof backend.coreAccept>[0];
  await backend.coreAccept(core, ["service"], "dashboard:maria.rossi@intcom.com");
  assert.equal(requests[0].url, "/api/core/tickets/c-1/accept");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    run_id: "run-2",
    actor: "dashboard:maria.rossi@intcom.com",
    fields: ["service"],
  });
});

test("anonymous writes explicitly expect the shared account", async () => {
  const backend = createBackendClient("/api", async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("X-Atlassian-Account-Id"), "shared");
    return Response.json({ results: [] });
  });
  await backend.patch([{ Key: "SUP-1", Status: "in progress" }], null);
});

test("questions and resolution notes retain the operator through the comment format", () => {
  for (const text of [
    "Which environment is affected?",
    "Resolution: Renewed certificate: login works.",
  ]) {
    assert.deepEqual(parseComment(signedComment(text, user.email)), {
      author: user.email,
      text,
    });
  }
});

test("copying a signed draft replaces its author without a second prefix", () => {
  assert.equal(
    signedComment("assignee@example.com: Resolution: Restarted service.", user.email),
    "maria.rossi@intcom.com: Resolution: Restarted service.",
  );
});

test("legacy unsigned comments keep their entire text instead of becoming an author", () => {
  for (const text of ["Which environment is affected?", "Resolution: Renewed certificate."]) {
    assert.deepEqual(parseComment(text), { author: null, text });
  }
});

test("typed text that starts like an email address is not taken for a signature", () => {
  for (const text of [
    "git@github.com:org/repo fails to clone over SSH",
    "ops@intcom.com: please rotate the certificate",
  ]) {
    assert.equal(signedComment(text, user.email), `${user.email}: ${text}`);
  }
});

test("only a missing backend reads as unreachable, not the backend's own 502", async () => {
  const failure = (response: Response) =>
    createBackendClient("/api", async () => response)
      .tickets()
      .then(
        () => assert.fail("expected a failure"),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          return error;
        },
      );

  const sync = await failure(
    Response.json(
      { error: { message: "Sync failed: Jira returned 500", code: "upstream_error" } },
      { status: 502 },
    ),
  );
  assert.equal(sync.code, "upstream_error");
  assert.equal(sync.message, "Sync failed: Jira returned 500");

  const proxy = await failure(
    Response.json(
      { error: { message: "backend unreachable", code: UNREACHABLE } },
      { status: 502 },
    ),
  );
  assert.equal(proxy.code, UNREACHABLE);

  const staticHost = await failure(
    new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
  );
  assert.equal(staticHost.code, UNREACHABLE);
});

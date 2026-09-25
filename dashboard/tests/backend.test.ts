import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HttpError,
  UNREACHABLE,
  createBackendClient,
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

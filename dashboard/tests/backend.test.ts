import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendClient, parseComment, signedComment } from "../src/lib/backend.ts";

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

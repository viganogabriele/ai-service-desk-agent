import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  duration,
  inferenceSeconds,
  modelName,
  outputFileName,
  parseChallengeFile,
  tokenizeJson,
} from "../src/lib/blind-test.ts";
import type { Pipeline } from "../src/lib/blind-test.ts";

const blindFile = readFileSync(
  new URL(
    "../../core/jira_hackathon_blind_eval_challenge_20260923083915-1141.json",
    import.meta.url,
  ),
  "utf8",
);

test("the challenge file parses and keeps every field", () => {
  const parsed = parseChallengeFile(blindFile);

  assert.ok(parsed.ok);
  assert.equal(parsed.file.records.length, 20);
  assert.equal(parsed.file.records[0]["Request type"], "New License");
  assert.deepEqual(Object.keys(parsed.file), Object.keys(JSON.parse(blindFile)));
});

test("a file the pipeline cannot fill is refused with the record named", () => {
  assert.deepEqual(parseChallengeFile("{"), { ok: false, error: "Not valid JSON." });
  assert.deepEqual(parseChallengeFile('{"records": []}'), {
    ok: false,
    error: "records: The file has no records.",
  });
  const broken = JSON.parse(blindFile);
  delete broken.records[3].Summary;
  const parsed = parseChallengeFile(JSON.stringify(broken));

  assert.ok(!parsed.ok);
  assert.match(parsed.error, /^records\[3\]\.Summary: /);
  const notes = JSON.parse(blindFile);
  notes.records[0]["All Comments"] = "one string";
  const bad = parseChallengeFile(JSON.stringify(notes));

  assert.ok(!bad.ok);
  assert.match(bad.error, /^records\[0\]\.All Comments: /);
});

test("json tokens join back to the text and tell keys from strings", () => {
  const text = JSON.stringify(
    { a: "x: y", n: -1.5e3, ok: true, none: null, list: ["s", 2] },
    null,
    2,
  );
  const tokens = tokenizeJson(text);

  assert.equal(tokens.map((token) => token.text).join(""), text);
  assert.deepEqual(
    tokens.filter((token) => token.type === "key").map((token) => token.text),
    ['"a"', '"n"', '"ok"', '"none"', '"list"'],
  );
  assert.deepEqual(
    tokens.filter((token) => token.type === "string").map((token) => token.text),
    ['"x: y"', '"s"'],
  );
  assert.deepEqual(
    tokens.filter((token) => token.type === "number").map((token) => token.text),
    ["-1500", "2"],
  );
  assert.deepEqual(
    tokens.filter((token) => token.type === "literal").map((token) => token.text),
    ["true", "null"],
  );
});

test("durations read at a glance", () => {
  assert.equal(duration(null), "—");
  assert.equal(duration(0.84), "0.8 s");
  assert.equal(duration(42.4), "42 s");
  assert.equal(duration(187.2), "3 m 07 s");
});

test("download names follow the input file and the pipeline", () => {
  assert.equal(outputFileName("blind.json", "submission", "openai/gpt-6-luna"), "blind_solution.json");
  assert.equal(
    outputFileName("blind.JSON", "reference", "swisscom/swiss-ai/Apertus-v1.5-70B"),
    "blind_reference_Apertus-v1.5-70B.json",
  );
  assert.equal(outputFileName(null, "submission", "x"), "blind_test_solution.json");
  assert.equal(modelName("swisscom/swiss-ai/Apertus-v1.5-70B"), "Apertus-v1.5-70B");
});

test("inference time is the mean over tickets that reached a model", () => {
  const ticket = (latency_ms: number): Pipeline["tickets"][number] => ({
    key: "R01",
    summary: null,
    status: "completed",
    seconds: null,
    latency_ms,
    error: null,
  });
  const pipeline = { tickets: [ticket(4000), ticket(0), ticket(2000)] } as Pipeline;

  assert.equal(inferenceSeconds(pipeline), 3);
  assert.equal(inferenceSeconds({ tickets: [ticket(0)] } as Pipeline), null);
});

/**
 * The blind test page: a challenge-format file checked in the browser, then triaged by the Core's
 * `POST /blind-tests` (core/api/blind_tests.py) through the backend's `/core` proxy.
 */

import { z } from "zod";

// The fields the Core writes back; the file keeps everything else as it is.
const record = z.looseObject({
  Summary: z.string(),
  "Work type": z.string().nullable(),
  "Affected Business or IT Services": z.array(z.string()),
  "Service Team(s)": z.array(z.string()),
  Assignee: z.string().nullable(),
  Urgency: z.string().nullable(),
  Impact: z.string().nullable(),
  Priority: z.string().nullable(),
  Resolution: z.string().nullable(),
  Status: z.string().nullable(),
  "All Comments": z.array(z.string()),
});

export const MAX_RECORDS = 200;

export const challengeFile = z.looseObject({
  records: z.array(record).min(1, "The file has no records.").max(MAX_RECORDS),
});

export type ChallengeFile = z.infer<typeof challengeFile>;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** `records[3].Summary` for a zod path, so the message points at the record. */
function pathLabel(path: PropertyKey[]) {
  return path.reduce<string>((label, part) => {
    const name = String(part);

    if (Number.isInteger(Number(name))) return `${label}[${name}]`;

    return label ? `${label}.${name}` : name;
  }, "");
}

export type Parsed = { ok: true; file: ChallengeFile } | { ok: false; error: string };

/** The dropped file's text as a challenge file, or one line saying why it is not. */
export function parseChallengeFile(text: string): Parsed {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }

  const result = challengeFile.safeParse(json);

  if (result.success) {
    // SAFETY: the schema accepted `json`; the original keeps the key order zod's copy would lose.
    return { ok: true, file: json as ChallengeFile };
  }

  const issue = result.error.issues[0];
  const where = issue ? pathLabel(issue.path) : "";

  return { ok: false, error: `${where ? `${where}: ` : ""}${issue?.message ?? "invalid file"}` };
}

export type PipelineKey = "submission" | "reference";

export interface TicketProgress {
  key: string;
  summary: string | null;
  status: "queued" | "running" | "completed" | "failed";
  seconds: number | null;
  latency_ms: number;
  error: string | null;
}

export interface PipelineUsage {
  cost: number;
  saved: number;
  calls: number;
  cache_hits: number;
  retries: number;
  errors: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  tokens: number;
  latency_ms: number;
  currency: string;
}

export interface Pipeline {
  key: PipelineKey;
  model: string;
  status: "queued" | "running" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  seconds: number | null;
  tickets: TicketProgress[];
  progress: { total: number; queued: number; running: number; completed: number; failed: number };
  usage: PipelineUsage;
  versions: { model: string; prompt: string; kb: string; policy: string } | null;
  output: ChallengeFile | null;
  error: string | null;
}

export interface BlindTest {
  blind_test_id: string;
  created_at: string;
  source: string | null;
  status: "running" | "completed" | "failed";
  tickets: number;
  input: ChallengeFile;
  pipelines: Pipeline[];
  skipped: { key: PipelineKey; model: string; reason: string }[];
}

// The same backend as the rest of the dashboard: the dev proxy at /api unless overridden.
const base = () => (import.meta.env.VITE_BACKEND_URL || "/api").replace(/\/+$/, "");

/** Where the page keeps the test it is showing, per backend, so a reload picks the polling back up. */
export const storageKey = () => `ticketbuddy-blind-test:${base()}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base()}/core${path}`, { ...init, credentials: "include" });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        `The Core did not answer (${response.status}). Check that the backend and Core are running.`,
    );
  }

  return response.json();
}

export function startBlindTest(input: ChallengeFile, source: string) {
  return request<{ blind_test_id: string; tickets: number }>("/blind-tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, source }),
  });
}

export function getBlindTest(id: string, signal?: AbortSignal) {
  return request<BlindTest>(`/blind-tests/${encodeURIComponent(id)}`, { signal });
}

export const PIPELINE_LABELS: Record<PipelineKey, string> = {
  submission: "Submission",
  reference: "Reference",
};

/** "gpt-6-luna" from "openai/gpt-6-luna", "Apertus-v1.5-70B" from "swisscom/swiss-ai/Apertus-v1.5-70B". */
export function modelName(model: string) {
  return model.slice(model.lastIndexOf("/") + 1);
}

/** The file name of a download: `<input stem>_solution.json` for the submission. */
export function outputFileName(source: string | null, key: PipelineKey, model: string) {
  const stem = (source ?? "blind_test").replace(/\.json$/i, "");
  const suffix = key === "submission" ? "solution" : `reference_${modelName(model)}`;

  return `${stem}_${suffix}.json`;
}

/** "0.8 s", "42 s", "3 m 07 s": one unit a judge can read at a glance. */
export function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";

  if (seconds < 10) return `${seconds.toFixed(1)} s`;

  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);

  return `${minutes} m ${String(rest).padStart(2, "0")} s`;
}

/** Mean model time per ticket so far, from the tickets that reached a provider. */
export function inferenceSeconds(pipeline: Pipeline) {
  const timed = pipeline.tickets.filter((ticket) => ticket.latency_ms > 0);

  if (!timed.length) return null;

  return timed.reduce((sum, ticket) => sum + ticket.latency_ms, 0) / timed.length / 1000;
}

export type JsonToken = {
  type: "key" | "string" | "number" | "literal" | "punctuation" | "space";
  text: string;
};

// A JSON token at a time: strings (keys when a colon follows), numbers, literals, punctuation, space.
const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/g;

/** Pretty-printed JSON split into tokens for colouring; joining the texts gives the input back. */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;

  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) tokens.push({ type: "space", text: text.slice(last, match.index) });
    const [whole, string, colon, number, literal, punctuation] = match;

    if (string !== undefined) {
      tokens.push({ type: colon ? "key" : "string", text: string });

      if (colon) tokens.push({ type: "punctuation", text: colon });
    } else if (number !== undefined) tokens.push({ type: "number", text: number });
    else if (literal !== undefined) tokens.push({ type: "literal", text: literal });
    else if (punctuation !== undefined) tokens.push({ type: "punctuation", text: punctuation });
    else tokens.push({ type: "space", text: whole });

    last = match.index + whole.length;
  }

  if (last < text.length) tokens.push({ type: "space", text: text.slice(last) });

  return tokens;
}

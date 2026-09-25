import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  Check,
  Coins,
  Cpu,
  FileJson2,
  Play,
  RefreshCw,
  Timer,
  Upload,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { JsonBlock, codeFrame } from "../components/json-view";
import { Dot, Pill } from "../components/ui/badge";
import type { Tone } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { SectionHead } from "../components/ui/section";
import { Segmented } from "../components/ui/segmented";
import {
  MAX_FILE_BYTES,
  PIPELINE_LABELS,
  duration,
  getBlindTest,
  inferenceSeconds,
  modelName,
  outputFileName,
  parseChallengeFile,
  startBlindTest,
  storageKey,
} from "../lib/blind-test";
import type { BlindTest, ChallengeFile, Pipeline, PipelineKey } from "../lib/blind-test";
import { compact, money } from "../lib/usage";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/blind-test")({ component: BlindTestPage });

const POLL_MS = 1500;

interface Loaded {
  name: string;
  file: ChallengeFile;
}

/** The test this browser started: its id, the file name, and when the pipelines were queued. */
interface Started {
  id: string;
  name: string;
  startedAt: number;
}

function readStarted(): Started | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey()) || "null");

    return saved?.id && saved?.name && saved?.startedAt ? saved : null;
  } catch {
    return null;
  }
}

function saveStarted(started: Started | null) {
  try {
    if (started) sessionStorage.setItem(storageKey(), JSON.stringify(started));
    else sessionStorage.removeItem(storageKey());
  } catch {
    // Without session storage the page still works; a reload just starts empty.
  }
}

function BlindTestPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState("");
  const [started, setStarted] = useState(readStarted);
  const [selected, setSelected] = useState<PipelineKey>("submission");

  const test = useQuery({
    queryKey: ["blind-test", started?.id],
    queryFn: ({ signal }) => getBlindTest(started?.id ?? "", signal),
    enabled: Boolean(started),
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_MS : false),
    retry: 1,
  });

  const start = useMutation({
    mutationFn: (input: Loaded) => startBlindTest(input.file, input.name),
    onSuccess: (result, input) => {
      const next = { id: result.blind_test_id, name: input.name, startedAt: Date.now() };
      setStarted(next);
      saveStarted(next);
      setSelected("submission");
    },
  });

  // The input shown: the file just dropped, else the one the Core stored (after a reload).
  const input = loaded?.file ?? test.data?.input ?? null;
  const inputName = loaded?.name ?? started?.name ?? null;
  const running = test.data?.status === "running" || (Boolean(started) && !test.data);

  function load(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setFileError("The file is larger than 5 MB.");

      return;
    }

    void file.text().then((text) => {
      const parsed = parseChallengeFile(text);

      if (!parsed.ok) {
        setFileError(parsed.error);

        return;
      }

      // A new file starts over: the previous output belongs to another input.
      setFileError("");
      setLoaded({ name: file.name, file: parsed.file });
      setStarted(null);
      saveStarted(null);
      start.reset();
    });
  }

  const pipelines = test.data?.pipelines ?? [];
  const pipeline = pipelines.find((item) => item.key === selected) ?? pipelines[0] ?? null;

  return (
    <div className="mx-auto flex max-w-330 flex-col gap-card-gap pb-card-gap">
      <SectionHead>
        <h1 className="font-display text-3xl leading-title font-semibold tracking-snug text-primary-text">
          Blind test pipeline
        </h1>
      </SectionHead>

      <div className="grid grid-cols-2 gap-card-gap max-lg:grid-cols-1">
        <InputCard
          input={input}
          name={inputName}
          error={fileError || start.error?.message || ""}
          onFile={load}
          busy={start.isPending || running}
          onRun={() => {
            if (input && inputName) start.mutate({ name: inputName, file: input });
          }}
        />
        <OutputCard
          test={test.data ?? null}
          pipeline={pipeline}
          selected={selected}
          onSelect={setSelected}
          pending={start.isPending || (Boolean(started) && test.isPending)}
          error={test.error?.message ?? null}
          onRetry={() => void test.refetch()}
        />
      </div>

      {pipeline && <Figures pipeline={pipeline} startedAt={started?.startedAt ?? null} />}
    </div>
  );
}

function InputCard({
  input,
  name,
  error,
  busy,
  onFile,
  onRun,
}: {
  input: ChallengeFile | null;
  name: string | null;
  error: string;
  busy: boolean;
  onFile: (file: File) => void;
  onRun: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];

    if (file) onFile(file);
  }

  return (
    <Card
      className={cn("flex flex-col gap-4", dragging && "border-primary/55")}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <CardHeader className="mb-0 flex-wrap items-center">
        <div>
          <CardTitle>Input</CardTitle>
          {input && (
            <CardDescription className="tabular-nums">
              {name} · {input.records.length} tickets
            </CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={picker}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose the blind test JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          {input && (
            <Button onClick={() => picker.current?.click()}>
              <Upload size={14} strokeWidth={1.75} />
              Replace
            </Button>
          )}
          <Button variant="primary" disabled={!input || busy} onClick={onRun}>
            <Play size={14} strokeWidth={2} />
            {busy ? "Running…" : "Run pipeline"}
          </Button>
        </div>
      </CardHeader>

      {input ? (
        <JsonBlock value={input} label="Input file" />
      ) : (
        <button
          type="button"
          className={cn(
            codeFrame,
            "grid cursor-pointer place-items-center border-dashed border-border-hover font-sans text-secondary transition-control duration-150 ease-soft hover:border-primary/55 hover:bg-drop",
            dragging && "border-primary bg-drop",
          )}
          onClick={() => picker.current?.click()}
        >
          <span className="grid justify-items-center gap-3">
            <Upload size={28} strokeWidth={1.5} className="text-muted" />
            <span className="text-md font-medium">Drop the blind test JSON</span>
            <span className="text-sm text-muted">or click to browse</span>
          </span>
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

const TONES: Record<Pipeline["tickets"][number]["status"], Tone> = {
  queued: "muted",
  running: "primary",
  completed: "success",
  failed: "danger",
};

function OutputCard({
  test,
  pipeline,
  selected,
  onSelect,
  pending,
  error,
  onRetry,
}: {
  test: BlindTest | null;
  pipeline: Pipeline | null;
  selected: PipelineKey;
  onSelect: (key: PipelineKey) => void;
  pending: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const options = (test?.pipelines ?? []).map((item) => ({
    value: item.key,
    label: PIPELINE_LABELS[item.key],
  }));

  function download() {
    if (!pipeline?.output) return;

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pipeline.output, null, 2)], { type: "application/json" }),
    );

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = outputFileName(test?.source ?? null, pipeline.key, pipeline.model);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="mb-0 flex-wrap items-center">
        <div>
          <CardTitle>
            Output
            {pipeline?.key === "submission" && (
              <Pill className="border-primary/45 text-primary-text">
                <Check size={12} strokeWidth={2.5} />
                Submission
              </Pill>
            )}
            {pipeline?.key === "reference" && (
              <Pill className="border-warning/45 text-warning">Reference only</Pill>
            )}
          </CardTitle>
          {pipeline && <CardDescription>{modelName(pipeline.model)}</CardDescription>}
        </div>
        <div className="flex items-center gap-2">
          {options.length > 1 && (
            <Segmented label="Pipeline" options={options} value={selected} onChange={onSelect} />
          )}
          <Button disabled={!pipeline?.output} onClick={download}>
            <ArrowDownToLine size={14} strokeWidth={1.75} />
            Download
          </Button>
        </div>
      </CardHeader>

      {error ? (
        <div className={cn(codeFrame, "grid place-items-center font-sans")} role="alert">
          <span className="grid justify-items-center gap-3 text-center">
            <span className="text-md text-danger">{error}</span>
            <Button onClick={onRetry}>
              <RefreshCw size={14} strokeWidth={1.75} />
              Try again
            </Button>
          </span>
        </div>
      ) : pipeline?.output ? (
        <JsonBlock value={pipeline.output} label={`${PIPELINE_LABELS[pipeline.key]} output`} />
      ) : pipeline?.status === "failed" ? (
        <div className={cn(codeFrame, "grid place-items-center font-sans")} role="alert">
          <span className="max-w-prose text-center text-md text-danger">{pipeline.error}</span>
        </div>
      ) : pipeline || pending ? (
        <Progress pipeline={pipeline} />
      ) : (
        <div className={cn(codeFrame, "grid place-items-center border-dashed")} aria-hidden="true">
          <FileJson2 size={28} strokeWidth={1.5} className="text-muted" />
        </div>
      )}
    </Card>
  );
}

/** What the pipeline is doing, ticket by ticket, so a long run never looks stuck. */
function Progress({ pipeline }: { pipeline: Pipeline | null }) {
  const total = pipeline?.progress.total ?? 0;
  const done = pipeline ? pipeline.progress.completed + pipeline.progress.failed : 0;

  return (
    <div
      className={cn(codeFrame, "flex flex-col gap-4 font-sans")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-baseline gap-3">
        <strong className="font-display text-4xl leading-kpi font-semibold tracking-tight tabular-nums">
          {done} / {total}
        </strong>
        <span className="text-sm text-secondary">tickets</span>
        <RefreshCw
          size={14}
          strokeWidth={1.75}
          className="ml-auto animate-spin text-primary-text"
        />
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-elevated">
        <div
          className="h-full rounded-pill bg-primary"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      {pipeline && (
        <ol className="grid gap-1.5 text-sm">
          {pipeline.tickets.map((ticket) => (
            <li key={ticket.key} className="flex items-center gap-3">
              <Dot
                tone={TONES[ticket.status]}
                className={cn("size-2", ticket.status === "running" && "animate-pulse")}
              />
              <span className="w-8 flex-none text-muted tabular-nums">{ticket.key}</span>
              <span className={cn("truncate", ticket.status === "queued" && "text-muted")}>
                {ticket.summary ?? ticket.key}
              </span>
              <span className="ml-auto flex-none text-muted tabular-nums">
                {ticket.status === "running"
                  ? "working"
                  : ticket.status === "failed"
                    ? "failed"
                    : ticket.seconds === null
                      ? ""
                      : duration(ticket.seconds)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One more thing: how long the models took, how long the whole run took, what it cost. */
function Figures({ pipeline, startedAt }: { pipeline: Pipeline; startedAt: number | null }) {
  const [now, setNow] = useState(Date.now);
  const live = pipeline.seconds === null;

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);

    return () => window.clearInterval(timer);
  }, [live]);

  // Elapsed time is measured here, from when this browser queued the run, so clock differences
  // between the Core and the judge's machine never show.
  const elapsed = pipeline.seconds ?? (startedAt === null ? null : (now - startedAt) / 1000);
  const { usage } = pipeline;
  const tickets = pipeline.progress.completed + pipeline.progress.failed;

  return (
    <Card>
      <dl className="grid grid-cols-4 gap-6 max-md:grid-cols-2">
        <Figure
          icon={Timer}
          label="Inference"
          value={duration(inferenceSeconds(pipeline))}
          note="model time per ticket"
        />
        <Figure
          icon={Workflow}
          label="Pipeline"
          value={duration(elapsed)}
          note={`end to end · ${tickets} of ${pipeline.progress.total} tickets`}
        />
        <Figure
          icon={Coins}
          label="Cost"
          value={money(usage.cost, usage.currency)}
          note={`${usage.calls} model calls${usage.cache_hits ? ` · ${usage.cache_hits} cached` : ""}`}
        />
        <Figure
          icon={Cpu}
          label="Tokens"
          value={compact(usage.tokens)}
          note={`${compact(usage.input_tokens)} in · ${compact(usage.output_tokens)} out`}
        />
      </dl>
    </Card>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-sm text-secondary">
        <Icon size={14} strokeWidth={1.75} />
        {label}
      </dt>
      <dd className="mt-2 truncate font-display text-4xl leading-kpi font-semibold tracking-tight tabular-nums max-sm:text-3xl">
        {value}
      </dd>
      <dd className="mt-1 truncate text-sm text-muted tabular-nums">{note}</dd>
    </div>
  );
}

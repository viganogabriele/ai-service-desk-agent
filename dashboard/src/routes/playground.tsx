import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, ArrowDownToLine, Check, FlaskConical, Play, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardTitle, Empty } from "../components/ui/card";
import { Field } from "../components/ui/form";
import { cn } from "../lib/utils";
import {
  EVALUATION_FIELDS,
  fieldName,
  getCases,
  getEvaluation,
  historyKey,
  metrics,
  percent,
  startEvaluation,
} from "../lib/evaluations";
import type { Evaluation, EvaluationCase, EvaluationRef } from "../lib/evaluations";

export const Route = createFileRoute("/playground")({ component: Playground });

const control =
  "h-11 w-full rounded-control border bg-field px-3 text-lg text-foreground hover:border-border-hover";

const baselineRef: EvaluationRef = {
  id: "saved-dev-baseline",
  model: "Qwen 3 · 4B",
  dataset: "Saved development fixtures",
};

function providerModel(provider: string) {
  if (provider === "openai") return "gpt-6-luna";

  if (provider === "swisscom") return "swiss-ai/Apertus-v1.5-70B";

  return "qwen2.5:7b";
}

function readHistory(): EvaluationRef[] {
  try {
    const saved: EvaluationRef[] = JSON.parse(localStorage.getItem(historyKey) || "[]");

    return Array.isArray(saved)
      ? saved.filter((entry) => entry?.id && entry?.model && entry?.dataset).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function Playground() {
  const [history, setHistory] = useState(readHistory);
  const [selected, setSelected] = useState(baselineRef.id);
  const [provider, setProvider] = useState("openai");
  const [comparisonProvider, setComparisonProvider] = useState("swisscom");
  const [model, setModel] = useState("gpt-6-luna");
  const [challenger, setChallenger] = useState("");
  const [dataset, setDataset] = useState("gold");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");

  const baseline = useQuery({
    queryKey: ["playground-baseline"],
    queryFn: async ({ signal }): Promise<Evaluation> => {
      const response = await fetch("/playground-baseline.json", { signal });

      if (!response.ok)
        throw new Error("Saved baseline could not be loaded. Run pnpm data and retry.");

      return response.json();
    },
  });

  const runs = useQueries({
    queries: history.map((entry) => ({
      queryKey: [historyKey, entry.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getEvaluation(entry.id, signal),
      refetchInterval: (query: { state: { data: Evaluation | undefined } }) => {
        const status = query.state.data?.status;

        return status === "completed" || status === "failed" ? false : 2000;
      },
      retry: 1,
    })),
  });

  const entries = [baselineRef, ...history];
  const allRuns = [baseline, ...runs];

  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === selected),
  );

  const active = allRuns[selectedIndex];
  const evaluation = active?.data;
  const saved = selectedIndex === 0;

  const caseQueries = useQueries({
    queries: history.map((entry, index) => ({
      queryKey: [historyKey, entry.id, "cases"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getCases(runs[index]?.data?.results?.shadow_run_ids ?? [], signal),
      enabled: runs[index]?.data?.status === "completed",
      staleTime: Infinity,
      retry: 1,
    })),
  });

  const caseQuery = caseQueries[selectedIndex - 1];
  const cases = saved ? (evaluation?.cases ?? []) : (caseQuery?.data ?? []);

  async function run() {
    setStarting(true);
    setError("");
    let updated = history;

    try {
      const models = [`${provider}/${model.trim()}`];

      if (challenger.trim()) models.push(`${comparisonProvider}/${challenger.trim()}`);

      for (const name of [...new Set(models)]) {
        const response = await startEvaluation(name, dataset);
        const entry = { id: response.evaluation_id, model: name, dataset };
        updated = [...updated, entry].slice(-12);
        setHistory(updated);
        setSelected(entry.id);

        try {
          localStorage.setItem(historyKey, JSON.stringify(updated));
        } catch {
          setStorageError(
            "Browser storage is unavailable. Export results before leaving this page.",
          );
        }
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not start the evaluation. Check the local backend connection.",
      );
    } finally {
      setStarting(false);
    }
  }

  function download() {
    if (!evaluation) return;

    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...evaluation, cases, source: saved ? "saved artifact" : "live shadow evaluation" },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${evaluation.evaluation_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-320 flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-5 pb-2">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-caps text-primary-text uppercase">
            <FlaskConical size={15} /> Model lab
          </p>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Test the model. See the tradeoffs.
          </h1>
          <p className="mt-3 max-w-160 text-md text-secondary">
            Compare triage quality, inspect mistakes, and measure how long each ticket takes.
          </p>
        </div>
        <span className="rounded-pill border px-3 py-2 text-sm text-secondary">
          Shadow runs · live tickets stay unchanged
        </span>
      </div>

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
          className="grid grid-cols-4 items-end gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1"
        >
          <div className="flex flex-col gap-3">
            <Field>
              Provider
              <select
                className={control}
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value);
                  setModel(providerModel(event.target.value));
                }}
              >
                <option value="openai">OpenAI API</option>
                <option value="swisscom">Apertus · Swisscom API</option>
                <option value="ollama">Local · Ollama</option>
              </select>
            </Field>
            <Field>
              Model
              <input
                className={control}
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Provider model ID"
              />
            </Field>
          </div>
          <div className="flex flex-col gap-3">
            <Field>
              Comparison provider
              <select
                className={control}
                value={comparisonProvider}
                onChange={(event) => {
                  setComparisonProvider(event.target.value);

                  if (challenger.trim()) setChallenger(providerModel(event.target.value));
                }}
              >
                <option value="swisscom">Apertus · Swisscom API</option>
                <option value="openai">OpenAI API</option>
                <option value="ollama">Local · Ollama</option>
              </select>
            </Field>
            <Field>
              Compare with <span className="sr-only">(optional)</span>
              <input
                className={control}
                value={challenger}
                onChange={(event) => setChallenger(event.target.value)}
                placeholder={providerModel(comparisonProvider)}
              />
            </Field>
          </div>
          <Field>
            Ticket set
            <select
              className={control}
              value={dataset}
              onChange={(event) => setDataset(event.target.value)}
            >
              <option value="gold">Reviewed tickets</option>
              <option value="recent">Recent tickets · 30 days</option>
            </select>
          </Field>
          <Button
            type="submit"
            variant="primary"
            className="h-11"
            disabled={starting || !model.trim()}
          >
            <Play size={15} />
            {starting ? "Queueing evaluations…" : "Run evaluation"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-secondary">
          OpenAI and Apertus runs send ticket content to the selected API. Reviewed tickets use
          human decisions as labels; recent tickets may have no labels. API credentials stay on the
          Core server.
        </p>
        <details className="mt-3 text-sm text-secondary">
          <summary className="cursor-pointer py-2 font-medium">API setup</summary>
          <p className="mt-2">
            Set OPENAI_API_KEY and APERTUS_API_KEY in the Core server environment, then restart it.
            Apertus uses the configured Swisscom endpoint (SWISSCOM_API_URL). Enter the exact model
            ID available to your account. Fill in “Compare with” to evaluate both providers. Leave
            it empty to run one model.
          </p>
        </details>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-control border border-danger/40 bg-danger/10 p-3 text-danger"
          >
            {error}
          </p>
        )}
        {storageError && (
          <p role="alert" className="mt-4 text-warning">
            {storageError}
          </p>
        )}
      </Card>

      <section aria-labelledby="comparison-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="comparison-heading" className="font-display text-xl font-semibold">
            Run comparison
          </h2>
          <span className="text-sm text-secondary">Select a run to explore its evidence</span>
        </div>
        <div className="overflow-x-auto rounded-card border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-secondary">
              <tr>
                <th scope="col" className="p-4">
                  Model / dataset
                </th>
                <th scope="col" className="p-4">
                  Source
                </th>
                <th scope="col" className="p-4 text-right">
                  Label match
                </th>
                <th scope="col" className="p-4 text-right">
                  Labelled decisions
                </th>
                <th scope="col" className="p-4 text-right">
                  Mean time
                </th>
                <th scope="col" className="p-4 text-right">
                  p95 time
                </th>
                <th scope="col" className="p-4 text-right">
                  Failed tickets
                </th>
                <th scope="col" className="p-4">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const data = allRuns[i]?.data;

                const score = data
                  ? metrics(data, i === 0 ? data.cases : caseQueries[i - 1]?.data)
                  : null;

                return (
                  <tr
                    key={entry.id}
                    className={cn(
                      "border-b last:border-0",
                      entry.id === selected && "bg-primary-subtle",
                    )}
                  >
                    <th scope="row" className="p-4">
                      <button
                        className="flex min-h-11 items-center gap-3 text-left whitespace-nowrap"
                        aria-pressed={entry.id === selected}
                        onClick={() => setSelected(entry.id)}
                      >
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border",
                            entry.id === selected && "border-primary text-primary-text",
                          )}
                        >
                          {entry.id === selected && <Check size={12} />}
                        </span>
                        <span>
                          <span className="block text-md font-medium">
                            {data?.results?.versions.model ?? entry.model}
                          </span>
                          <span className="mt-1 block font-normal text-secondary">
                            {entry.dataset}
                          </span>
                        </span>
                      </button>
                    </th>
                    <td className="p-4 whitespace-nowrap text-secondary">
                      {i === 0 ? "Saved artifact" : "Live shadow"}
                    </td>
                    <td className="p-4 text-right font-semibold tabular-nums">
                      {score ? percent(score.accuracy) : "—"}
                    </td>
                    <td className="p-4 text-right tabular-nums">{score?.labelled ?? "—"}</td>
                    <td className="p-4 text-right tabular-nums">
                      {score?.mean == null ? "—" : `${score.mean.toFixed(2)}s`}
                    </td>
                    <td className="p-4 text-right tabular-nums">
                      {score?.p95 == null ? "—" : `${score.p95.toFixed(2)}s`}
                    </td>
                    <td className="p-4 text-right tabular-nums">
                      {data?.results?.summary.failed ?? "—"}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      {allRuns[i]?.isError
                        ? "Connection error"
                        : data?.status === "completed"
                          ? "Complete"
                          : data?.status === "failed"
                            ? "Failed"
                            : "Queued / running"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-secondary">
          Compare scores only for matching ticket sets and label coverage. The saved six-case smoke
          benchmark is a different pipeline and dataset, not a model ranking.
        </p>
      </section>

      {active?.isError ? (
        <Empty>
          <p role="alert">{active.error.message}</p>
          <Button className="mt-4" onClick={() => void active.refetch()}>
            <RefreshCw size={14} />
            Retry loading run
          </Button>
        </Empty>
      ) : !evaluation || !evaluation.results ? (
        <Empty>
          <Activity size={24} className="mx-auto mb-3 text-primary-text" />
          <p role="status">
            {evaluation?.status === "failed"
              ? "Evaluation failed. Check the Core logs and try a new run."
              : "Waiting for evaluation results…"}
          </p>
          <p className="mt-2 text-sm">
            {saved
              ? "Loading the saved development baseline."
              : `Run ${selected} is stored in the Core. You can leave and return while it runs.`}
          </p>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold">Run evidence</h2>
              <p className="mt-1 text-sm text-secondary">
                {saved
                  ? "Saved baseline · output/dev_predictions.json · run date and hardware not recorded"
                  : `${evaluation.evaluation_id} · ${evaluation.created_at ? new Date(evaluation.created_at).toLocaleString() : "Date unavailable"}`}
              </p>
            </div>
            <Button onClick={download} disabled={!saved && caseQuery?.isPending}>
              <ArrowDownToLine size={15} />
              Export results
            </Button>
          </div>
          <Results key={selected} evaluation={evaluation} cases={cases} saved={saved} />
          {!saved && caseQuery?.isPending && (
            <p role="status" className="text-secondary">
              Loading per-ticket timings…
            </p>
          )}
          {!saved && caseQuery?.isError && (
            <p role="alert" className="text-danger">
              Timings unavailable: {caseQuery?.error?.message}{" "}
              <Button onClick={() => void caseQuery?.refetch()}>Retry timings</Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Results({
  evaluation,
  cases,
  saved,
}: {
  evaluation: Evaluation;
  cases: EvaluationCase[];
  saved: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const result = evaluation.results;

  if (!result) return null;
  const score = metrics(evaluation, cases);
  const visible = result.disagreements.filter((item) => filter === "all" || item.field === filter);
  const maxSeconds = Math.max(1, ...cases.map((item) => item.seconds ?? 0));

  const stats = [
    {
      label: "Label match",
      value: percent(score.accuracy),
      note: `${score.correct} / ${score.labelled} labelled decisions`,
    },
    {
      label: "Mean ticket time",
      value: score.mean === null ? "—" : `${score.mean.toFixed(2)}s`,
      note: "Completed tickets with recorded timing",
    },
    {
      label: "p95 ticket time",
      value: score.p95 === null ? "—" : `${score.p95.toFixed(2)}s`,
      note: "95th percentile · nearest rank",
    },
    {
      label: "Completed tickets",
      value: `${result.summary.tickets - result.summary.failed} / ${result.summary.tickets}`,
      note: saved
        ? `${result.summary.failed} failed · saved development run`
        : `${result.summary.failed} failed · ${result.summary.changed_decisions} changes vs live`,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-4 gap-card-gap max-lg:grid-cols-2 max-sm:grid-cols-1">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-sm text-secondary">{stat.label}</p>
            <p className="mt-3 text-5xl font-semibold tracking-tight tabular-nums">{stat.value}</p>
            <p className="mt-3 text-xs text-secondary">{stat.note}</p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-card-gap max-md:grid-cols-1">
        <Card>
          <CardTitle>Where the model gets it right</CardTitle>
          <p className="mt-2 mb-6 text-sm text-secondary">
            Match against reference labels, by field. Confidence is not accuracy.
          </p>
          <div className="flex flex-col gap-4">
            {Object.entries(EVALUATION_FIELDS).map(([field, name]) => {
              const item = result.per_field[field];

              return (
                <div key={field}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span>{name}</span>
                    <span className="text-sm tabular-nums">
                      {item?.n_labelled
                        ? `${percent(item.agreement_label)} · ${item.agree_label}/${item.n_labelled}`
                        : "Unlabelled"}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-pill bg-elevated"
                    role="img"
                    aria-label={`${name}: ${item?.n_labelled ? percent(item.agreement_label) : "unlabelled"}`}
                  >
                    <div
                      className="h-full rounded-pill bg-primary"
                      style={{ width: `${(item?.agreement_label ?? 0) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardTitle>Time spent on each ticket</CardTitle>
          <p className="mt-2 mb-6 text-sm text-secondary">
            {saved
              ? "Recorded classification + comment generation time."
              : "Core run elapsed time, including cache effects; timestamps have one-second precision."}
          </p>
          {cases.length ? (
            <div className="flex max-h-100 flex-col gap-4 overflow-y-auto pr-2">
              {cases.map((item, index) => (
                <div key={`${item.ticket_id}-${index}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="truncate text-sm" title={item.title ?? item.ticket_id}>
                      {item.title ?? item.ticket_id}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      {item.status === "failed"
                        ? "Failed"
                        : item.seconds === null
                          ? "No timing"
                          : `${item.seconds.toFixed(2)}s`}
                    </span>
                  </div>
                  <div className="h-2 rounded-pill bg-elevated">
                    <div
                      className="h-full rounded-pill bg-accent"
                      style={{ width: `${((item.seconds ?? 0) / maxSeconds) * 100}%` }}
                    />
                  </div>
                  {item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
                </div>
              ))}
            </div>
          ) : (
            <Empty>No per-ticket timing available yet.</Empty>
          )}
          <p className="mt-5 border-t pt-4 text-xs text-secondary">
            Timings are observations from this run, not a hardware benchmark. Token use and cost of
            every evaluation are on the Usage page.
          </p>
        </Card>
      </div>
      {saved && (
        <Card>
          <CardTitle>Explore the labelled cases</CardTitle>
          <p className="mt-2 mb-4 text-sm text-secondary">
            Open a case to compare each prediction with its hand-written reference.
          </p>
          <div className="divide-y divide-border">
            {cases.map((item) => (
              <details key={item.ticket_id} className="py-1">
                <summary className="cursor-pointer py-3 font-medium">{item.title}</summary>
                <div className="grid grid-cols-2 gap-3 pb-4 max-sm:grid-cols-1">
                  {item.checks?.map((check) => (
                    <div key={check.field} className="rounded-control bg-elevated p-3">
                      <p className="mb-2 text-sm text-primary-text">
                        {fieldName(check.field)} ·{" "}
                        {check.prediction === check.label ? "Match" : "Mismatch"}
                      </p>
                      <p>Predicted: {check.prediction}</p>
                      <p className="mt-1 text-secondary">Reference: {check.label}</p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
      {!saved && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Disagreement explorer</CardTitle>
              <p className="mt-2 text-sm text-secondary">
                Changed decisions and reference mismatches. A change is not necessarily a mistake.
              </p>
            </div>
            <Field>
              Filter by field
              <select
                className={control}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">All fields</option>
                {Object.entries(EVALUATION_FIELDS).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {visible.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-secondary">
                  <tr>
                    {[
                      "Ticket",
                      "Field",
                      "Model prediction",
                      "Live prediction",
                      "Human label",
                      "Result",
                    ].map((label) => (
                      <th scope="col" className="p-3" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item, index) => (
                    <tr
                      key={`${item.ticket_id}-${item.field}-${index}`}
                      className="border-b last:border-0"
                    >
                      <th scope="row" className="p-3 font-medium">
                        {item.ticket_id}
                      </th>
                      <td className="p-3">{fieldName(item.field)}</td>
                      <td className="p-3">{item.shadow ?? "—"}</td>
                      <td className="p-3 text-secondary">{item.live ?? "—"}</td>
                      <td className="p-3">{item.label ?? "Unlabelled"}</td>
                      <td
                        className={cn(
                          "p-3",
                          item.label === null
                            ? "text-secondary"
                            : item.shadow === item.label
                              ? "text-success"
                              : "text-danger",
                        )}
                      >
                        {item.label === null
                          ? "Unscored"
                          : item.shadow === item.label
                            ? "Match"
                            : "Mismatch"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              {result.summary.tickets === 0
                ? "No tickets in this set. Review tickets first, or choose recent tickets."
                : "No disagreements for this selection."}
            </Empty>
          )}
          <p className="mt-4 text-xs text-secondary">
            Versions:{" "}
            {Object.entries(result.versions)
              .map(([name, value]) => `${name}: ${value}`)
              .join(" · ")}
          </p>
        </Card>
      )}
      <p className="text-sm text-secondary">
        {saved
          ? "Only service and work type have reference labels in these six fixtures. This small development set cannot establish hidden-challenge accuracy."
          : "Label match is agreement with available human reviews, not independently verified ground truth. Failed tickets are reported separately and excluded from labelled-decision scores."}
      </p>
    </>
  );
}

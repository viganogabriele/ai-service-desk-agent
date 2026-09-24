import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bundle, Outcome, Proposal, Status, Triage } from "./domain";
import {
  LEVELS,
  OUTCOMES,
  RESOLUTIONS,
  STATUS_LABELS,
  priority,
  serviceInfo,
  startingTriage,
  triageChanges,
} from "./domain";

export interface Review {
  status: Status;
  triage: Triage;
  reply: string;
  outcome: Outcome;
  question: string;
  // 0 is the bundled proposal; n is the n-th stronger-model regeneration.
  version: number;
  updated_at?: string;
}

export interface Action {
  ticket_id: string;
  action: "assign" | "resolve" | "ask" | "move" | "reopen" | "regenerate";
  timestamp: string;
  model_id: string | null;
  // Fields the operator changed relative to the AI proposal, when one existed.
  changed_fields: { field: string; proposed: string; final: string }[];
  hint?: string;
}

interface SavedState {
  reviews: Record<string, Review>;
  actions: Action[];
  regenerated: Record<string, Proposal[]>;
}

export interface Notice {
  message: string;
  undo?: () => void;
}

export interface StrongerModel {
  configured: boolean;
  online: boolean;
  model: string | null;
}

export type Editable = Partial<Pick<Review, "triage" | "reply" | "outcome" | "question">>;

interface DashboardContextValue {
  data: Bundle;
  actions: Action[];
  stronger: StrongerModel;
  notice: Notice | null;
  dismissNotice: () => void;
  idOf: (index: number) => string;
  review: (index: number) => Review;
  proposalFor: (index: number) => Proposal | null;
  update: (index: number, changes: Editable) => void;
  assign: (index: number, changes?: Editable) => void;
  resolve: (index: number, changes?: Editable) => void;
  askReporter: (index: number, changes?: Editable) => void;
  move: (index: number, status: "new" | "in_progress") => void;
  regenerate: (index: number, hint: string) => Promise<void>;
  reset: () => void;
  exportData: () => void;
}

interface SolverRecord {
  "Work type"?: string;
  "Affected Business or IT Services"?: string[];
  Assignee?: string | null;
  Urgency?: string;
  Impact?: string;
  Resolution?: string;
  "Resolution text"?: string;
  _triage?: {
    reason?: string;
    model?: string;
    classification_seconds?: number;
    comment_seconds?: number;
    historical_assignee_vote_share?: number;
    historical_assignee_support?: number;
    review_flags?: string[];
  };
}

const STORAGE_KEY = "service-desk-reviews-v2";

const STRONGER_URL: string | null = import.meta.env.VITE_PREMIUM_SOLVER_URL || null;

const EMPTY: SavedState = { reviews: {}, actions: [], regenerated: {} };

const DashboardContext = createContext<DashboardContextValue | null>(null);

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function downloadJson(value: { records: Record<string, string | string[] | boolean | null>[] }) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "triaged-tickets.json";
  link.click();
  URL.revokeObjectURL(url);
}

class SolverError extends Error {}

/** Map one record from the triage PoC `POST /triage` response; any missing field rejects the whole response. */
function fromSolver(record: SolverRecord | undefined, id: string): Proposal {
  const triage = record?._triage;
  const service = record?.["Affected Business or IT Services"]?.[0];
  const urgency = LEVELS.find((level) => level.toLowerCase() === record?.Urgency?.toLowerCase());
  const impact = LEVELS.find((level) => level.toLowerCase() === record?.Impact?.toLowerCase());
  const resolution = RESOLUTIONS.find((item) => item === record?.Resolution?.toLowerCase());

  if (
    !record ||
    !triage?.model ||
    !record["Work type"] ||
    !service ||
    !serviceInfo(service) ||
    !urgency ||
    !impact ||
    !resolution
  )
    throw new SolverError(
      "The stronger model returned an incomplete suggestion. Nothing was changed.",
    );
  const assignee = record.Assignee ?? "";
  const support = triage.historical_assignee_support ?? 0;

  return {
    ticket_id: id,
    model_id: triage.model,
    latency_ms:
      triage.classification_seconds === undefined || triage.comment_seconds === undefined
        ? null
        : Math.round((triage.classification_seconds + triage.comment_seconds) * 1000),
    cost_chf: null,
    proposal: {
      work_type: record["Work type"],
      service,
      assignee_candidates: assignee
        ? [
            {
              email: assignee,
              historical_count: Math.round((triage.historical_assignee_vote_share ?? 0) * support),
              support,
            },
          ]
        : [],
      urgency,
      impact,
      resolution,
      resolution_comment: record["Resolution text"] ?? "",
    },
    rationale: triage.reason ?? "",
    review_flags: triage.review_flags ?? [],
  };
}

function initialReview(
  ticket: Bundle["challenge"][number],
  proposal: Proposal | null,
  version = 0,
) {
  const aiResolution = proposal?.proposal.resolution;
  const draft = proposal?.proposal.resolution_comment ?? "";

  return {
    status: "new",
    triage: startingTriage(ticket, proposal),
    // The solver's draft is a resolution note, not a question, so it only pre-fills the reply.
    reply: aiResolution && aiResolution !== "clarification" ? draft : "",
    question: "",
    outcome: OUTCOMES.find((item) => item === aiResolution) ?? "done",
    version,
  } satisfies Review;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const query = useQuery<Bundle>({
    queryKey: ["dashboard-data"],
    queryFn: async () => {
      const response = await fetch("/dashboard-data.json");

      if (!response.ok) throw new Error("Ticket data could not be loaded.");

      return response.json();
    },
    staleTime: Infinity,
  });

  const health = useQuery<{ model: string }>({
    queryKey: ["stronger-model-health"],
    enabled: STRONGER_URL !== null,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch(`${STRONGER_URL}/health`);

      if (!response.ok) throw new Error("Stronger model unavailable");

      return response.json();
    },
  });

  const [saved, setSaved] = useState<SavedState>(loadSaved);
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (query.isPending) return <div className="loading">Loading tickets…</div>;

  if (query.isError) return <div className="loading">{query.error.message}</div>;

  const data = query.data;
  const idOf = (index: number) => `CH-${String(index + 1).padStart(2, "0")}`;

  const proposalAt = (index: number, version: number) =>
    version > 0
      ? (saved.regenerated[idOf(index)]?.[version - 1] ?? data.proposals[index])
      : data.proposals[index];

  const review = (index: number): Review =>
    saved.reviews[idOf(index)] ?? initialReview(data.challenge[index], data.proposals[index]);

  const proposalFor = (index: number) => proposalAt(index, review(index).version);

  const show = (value: Notice) => {
    window.clearTimeout(timer.current);
    setNotice(value);
    timer.current = window.setTimeout(() => setNotice(null), 8000);
  };

  const write = (index: number, next: Review | null, entry?: Action) =>
    setSaved((state) => {
      const reviews = { ...state.reviews };

      if (next) reviews[idOf(index)] = next;
      else delete reviews[idOf(index)];

      return { ...state, reviews, actions: entry ? [...state.actions, entry] : state.actions };
    });

  const update = (index: number, changes: Editable) => {
    const current = review(index);

    write(index, {
      ...current,
      ...changes,
      status: current.status === "new" ? "in_progress" : current.status,
      updated_at: new Date().toISOString(),
    });
  };

  /** Apply a workflow transition, log it, and offer a one-step undo. */
  const transition = (
    index: number,
    status: Status,
    action: Action["action"],
    message: string,
    changes: Editable = {},
  ) => {
    const before = saved.reviews[idOf(index)] ?? null;
    const current = { ...review(index), ...changes };
    const proposal = proposalFor(index);

    const changedFields = proposal
      ? triageChanges(current.triage, startingTriage(data.challenge[index], proposal)).map(
          (item) => ({ field: item.field, proposed: item.before, final: item.after }),
        )
      : [];

    write(
      index,
      { ...current, status, updated_at: new Date().toISOString() },
      {
        ticket_id: idOf(index),
        action,
        timestamp: new Date().toISOString(),
        model_id: proposal?.model_id ?? null,
        changed_fields: changedFields,
      },
    );
    show({ message, undo: () => write(index, before) });
  };

  const team = (index: number) =>
    serviceInfo(review(index).triage.service)?.[1] ?? "the service team";

  const regenerate = async (index: number, hint: string) => {
    if (!STRONGER_URL) throw new SolverError("No stronger model is configured.");
    const ticket = data.challenge[index];
    const id = idOf(index);
    let response: Response;

    try {
      response = await fetch(`${STRONGER_URL}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { ...ticket, "All Comments": [...ticket["All Comments"], `operator: ${hint}`] },
        ]),
      });
    } catch {
      throw new SolverError("The stronger model is not reachable right now. Try again later.");
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok)
      throw new SolverError(
        `The stronger model could not process this ticket${payload?.error ? `: ${payload.error}` : "."}`,
      );
    const proposal = fromSolver(Array.isArray(payload) ? payload[0] : undefined, id);
    const before = saved.reviews[id] ?? null;
    const versions = [...(saved.regenerated[id] ?? []), proposal];

    setSaved((state) => ({
      reviews: {
        ...state.reviews,
        [id]: {
          ...initialReview(ticket, proposal, versions.length),
          status: "in_progress",
          updated_at: new Date().toISOString(),
        },
      },
      regenerated: { ...state.regenerated, [id]: versions },
      actions: [
        ...state.actions,
        {
          ticket_id: id,
          action: "regenerate",
          timestamp: new Date().toISOString(),
          model_id: proposal.model_id,
          changed_fields: [],
          hint,
        },
      ],
    }));
    show({
      message: `New suggestion from ${proposal.model_id} applied to ${id}.`,
      undo: () => write(index, before),
    });
  };

  const exportData = () => {
    const records = data.challenge.map((ticket, index) => {
      const current = review(index);
      const { triage } = current;
      const info = serviceInfo(triage.service);
      const aiResolution = proposalFor(index)?.proposal.resolution ?? null;

      const resolution =
        current.status === "resolved"
          ? current.outcome
          : current.status === "waiting"
            ? "clarification"
            : aiResolution;

      const comment =
        current.status === "waiting" ? current.question : current.reply || current.question;

      return {
        ...ticket,
        "Work type": triage.work_type,
        "Affected Business or IT Services": [triage.service],
        "Service Team(s)": info ? [info[1]] : [],
        Assignee: triage.assignee || null,
        Urgency: triage.urgency,
        Impact: triage.impact,
        Priority: priority(triage.urgency, triage.impact),
        Status: current.status === "resolved" ? "done" : ticket.Status,
        Resolution: resolution,
        "All Comments": comment.trim()
          ? [...ticket["All Comments"], `${triage.assignee}: ${comment.trim()}`]
          : ticket["All Comments"],
        reviewed: current.status !== "new" && current.status !== "in_progress",
      };
    });

    downloadJson({ records });
  };

  return (
    <DashboardContext.Provider
      value={{
        data,
        actions: saved.actions,
        stronger: {
          configured: STRONGER_URL !== null,
          online: health.isSuccess,
          model: health.data?.model ?? null,
        },
        notice,
        dismissNotice: () => setNotice(null),
        idOf,
        review,
        proposalFor,
        update,
        assign: (index, changes) =>
          transition(
            index,
            "assigned",
            "assign",
            `${idOf(index)} assigned to ${team(index)}.`,
            changes,
          ),
        resolve: (index, changes) =>
          transition(index, "resolved", "resolve", `${idOf(index)} resolved.`, changes),
        askReporter: (index, changes) =>
          transition(
            index,
            "waiting",
            "ask",
            `Question sent to ${data.challenge[index].Reporter} for ${idOf(index)}.`,
            changes,
          ),
        move: (index, status) =>
          transition(
            index,
            status,
            status === "new" ? "reopen" : "move",
            `${idOf(index)} moved to ${STATUS_LABELS[status]}.`,
          ),
        regenerate,
        reset: () => setSaved(EMPTY),
        exportData,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);

  if (!context) throw new Error("Dashboard context missing");

  return context;
}

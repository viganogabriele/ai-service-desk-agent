import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bundle, FormValues, Level, Proposal, Resolution, ReviewStatus } from "./domain";
import { LEVELS, RESOLUTIONS, formChanges, priority, serviceInfo, startingForm } from "./domain";

export interface Review {
  status: ReviewStatus;
  form: FormValues;
  // 0 is the bundled proposal; n is the n-th premium regeneration.
  version?: number;
  previous?: { status: ReviewStatus; form: FormValues; version?: number };
}

export interface Action {
  ticket_id: string;
  action: string;
  timestamp: string;
  model_id: string;
  changed_fields: { field: string; proposed: string; final: string }[];
  hint?: string;
  escalation_reason?: string;
  message?: string;
}

export interface ActOptions {
  reason?: string;
  message?: string;
}

interface SavedState {
  reviews: Record<string, Review>;
  actions: Action[];
  regenerated: Record<string, Proposal[]>;
}

export interface PremiumSolver {
  url: string | null;
  online: boolean;
  model: string | null;
}

interface DashboardContextValue {
  data: Bundle;
  reviews: Record<string, Review>;
  actions: Action[];
  premium: PremiumSolver;
  review: (index: number) => Review;
  proposalFor: (index: number) => Proposal;
  history: (index: number) => Proposal[];
  edit: (index: number, form: FormValues) => void;
  act: (index: number, action: string, options?: ActOptions) => void;
  regenerate: (index: number, hint: string) => Promise<void>;
  undo: (index: number) => void;
  reset: () => void;
  exportData: () => void;
}

interface SolverRecord {
  "Work type": string;
  "Affected Business or IT Services": string[];
  Assignee: string | null;
  Urgency: string;
  Impact: string;
  Resolution: string;
  "Resolution text": string;
  _triage: {
    reason: string;
    model: string;
    classification_seconds: number;
    comment_seconds: number;
    historical_assignee_vote_share: number;
    historical_assignee_support: number;
  };
}

const STORAGE_KEY = "ai-ticket-triage-demo-v1";

const PREMIUM_URL: string | null = import.meta.env.VITE_PREMIUM_SOLVER_URL || null;

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
  link.download = "triaged-challenge.json";
  link.click();
  URL.revokeObjectURL(url);
}

function asLevel(value: string, fallback: Level): Level {
  return LEVELS.find((level) => level.toLowerCase() === value.toLowerCase()) ?? fallback;
}

function asResolution(value: string, fallback: Resolution): Resolution {
  return RESOLUTIONS.find((item) => item === value.toLowerCase()) ?? fallback;
}

/** Map one record from the triage PoC `POST /triage` response onto the §3.1 proposal contract. */
function fromSolver(record: SolverRecord, base: Proposal): Proposal {
  const assignee = record.Assignee ?? "";
  const triage = record._triage;

  return {
    ticket_id: base.ticket_id,
    model_id: triage.model,
    generated_at: new Date().toISOString(),
    latency_ms: Math.round((triage.classification_seconds + triage.comment_seconds) * 1000),
    cost_chf: null,
    proposal: {
      work_type: record["Work type"],
      service: record["Affected Business or IT Services"][0] ?? base.proposal.service,
      assignee_candidates: assignee
        ? [
            {
              email: assignee,
              historical_count: Math.round(
                triage.historical_assignee_vote_share * triage.historical_assignee_support,
              ),
            },
          ]
        : [],
      urgency: asLevel(record.Urgency, base.proposal.urgency),
      impact: asLevel(record.Impact, base.proposal.impact),
      resolution: asResolution(record.Resolution, base.proposal.resolution),
      resolution_comment: `${assignee}: ${record["Resolution text"]}`,
    },
    confidence: { work_type: null, service: null },
    rationale: triage.reason,
    similar_tickets: base.similar_tickets,
  };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const query = useQuery<Bundle>({
    queryKey: ["dashboard-data"],
    queryFn: async () => {
      const response = await fetch("/dashboard-data.json");

      if (!response.ok) throw new Error("Dashboard data could not be loaded");

      return response.json();
    },
    staleTime: Infinity,
  });

  const health = useQuery<{ model: string }>({
    queryKey: ["premium-health"],
    enabled: PREMIUM_URL !== null,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch(`${PREMIUM_URL}/health`);

      if (!response.ok) throw new Error("Premium solver unavailable");

      return response.json();
    },
  });

  const [saved, setSaved] = useState<SavedState>(loadSaved);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  if (query.isPending) return <div className="loading">Loading ticket data…</div>;

  if (query.isError) return <div className="loading">{query.error.message}</div>;

  const data = query.data;
  const idOf = (index: number) => data.proposals[index].ticket_id;
  const history = (index: number) => saved.regenerated[idOf(index)] ?? [];

  const proposalAt = (index: number, version = 0) =>
    version > 0 ? (history(index)[version - 1] ?? data.proposals[index]) : data.proposals[index];

  const review = (index: number): Review =>
    saved.reviews[idOf(index)] ?? {
      status: "to_process",
      form: startingForm(data.proposals[index]),
    };

  const proposalFor = (index: number) => proposalAt(index, review(index).version);

  const edit = (index: number, form: FormValues) => {
    setSaved((current) => ({
      ...current,
      reviews: {
        ...current.reviews,
        [idOf(index)]: { ...review(index), status: "in_review", form },
      },
    }));
  };

  const act = (index: number, action: string, options: ActOptions = {}) => {
    const proposal = proposalFor(index);
    const id = idOf(index);
    const current = review(index);
    let form = current.form;
    let status: ReviewStatus = "accepted";

    if (action === "modify") status = "modified_accepted";

    if (action === "escalate") status = "escalated";

    if (action === "clarify") {
      status = "clarification_requested";
      form = {
        ...form,
        resolution: "clarification",
        resolution_comment: `${form.assignee}: ${
          options.message ?? "Could you clarify the requested outcome and affected service?"
        }`,
      };
    }

    const changedFields = formChanges(form, startingForm(proposal)).map((item) => ({
      field: item.field,
      proposed: item.before,
      final: item.after,
    }));

    const logEntry: Action = {
      ticket_id: id,
      action,
      timestamp: new Date().toISOString(),
      model_id: proposal.model_id,
      changed_fields: changedFields,
    };

    if (action === "escalate") logEntry.escalation_reason = options.reason ?? "Other";

    if (options.message) logEntry.message = options.message;
    setSaved((state) => ({
      ...state,
      reviews: {
        ...state.reviews,
        [id]: {
          status,
          form,
          version: current.version,
          previous: { status: current.status, form: current.form, version: current.version },
        },
      },
      actions: [...state.actions, logEntry],
    }));
  };

  const regenerate = async (index: number, hint: string) => {
    if (!PREMIUM_URL) throw new Error("No premium solver configured");
    const ticket = data.challenge[index];
    const id = idOf(index);

    const response = await fetch(`${PREMIUM_URL}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { ...ticket, "All Comments": [...ticket["All Comments"], `operator: ${hint}`] },
      ]),
    });

    const payload = await response.json();

    if (!response.ok) throw new Error(payload.error ?? `Solver returned ${response.status}`);
    const proposal = fromSolver(payload[0], data.proposals[index]);

    setSaved((state) => {
      const previous = state.reviews[id] ?? review(index);
      const versions = [...(state.regenerated[id] ?? []), proposal];

      return {
        reviews: {
          ...state.reviews,
          [id]: {
            status: "proposed",
            form: startingForm(proposal),
            version: versions.length,
            previous: { status: previous.status, form: previous.form, version: previous.version },
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
      };
    });
  };

  const undo = (index: number) => {
    const id = idOf(index);
    const current = review(index);

    if (!current.previous) return;
    const previous = current.previous;

    setSaved((state) => ({
      ...state,
      reviews: { ...state.reviews, [id]: previous },
      actions: [
        ...state.actions,
        {
          ticket_id: id,
          action: "undo",
          timestamp: new Date().toISOString(),
          model_id: proposalFor(index).model_id,
          changed_fields: [],
        },
      ],
    }));
  };

  const exportData = () => {
    const records = data.challenge.map((ticket, index) => {
      const current = review(index);
      const form = current.form;
      const info = serviceInfo(form.service);

      return {
        ...ticket,
        "Work type": form.work_type,
        "Affected Business or IT Services": [form.service],
        "Service Team(s)": info ? [info[1]] : [],
        Assignee: form.assignee || null,
        Urgency: form.urgency,
        Impact: form.impact,
        Priority: priority(form.urgency, form.impact),
        Resolution: form.resolution,
        "All Comments": [...ticket["All Comments"], form.resolution_comment],
        reviewed: current.status === "accepted" || current.status === "modified_accepted",
      };
    });

    downloadJson({ records });
  };

  return (
    <DashboardContext.Provider
      value={{
        data,
        reviews: saved.reviews,
        actions: saved.actions,
        premium: {
          url: PREMIUM_URL,
          online: health.isSuccess,
          model: health.data?.model ?? null,
        },
        review,
        proposalFor,
        history,
        edit,
        act,
        regenerate,
        undo,
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

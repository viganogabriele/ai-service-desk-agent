import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bundle, FormValues, ReviewStatus } from "./domain";
import { priority, serviceInfo, startingForm } from "./domain";

interface Review {
  status: ReviewStatus;
  form: FormValues;
  previous?: { status: ReviewStatus; form: FormValues };
}

interface Action {
  ticket_id: string;
  action: string;
  timestamp: string;
  model_id: string;
  changed_fields: { field: string; proposed: string; final: string }[];
  hint?: string;
  escalation_reason?: string;
}

interface SavedState {
  reviews: Record<string, Review>;
  actions: Action[];
}

interface DashboardContextValue {
  data: Bundle;
  reviews: Record<string, Review>;
  actions: Action[];
  review: (index: number) => Review;
  edit: (index: number, form: FormValues) => void;
  act: (index: number, action: string, reason?: string) => void;
  undo: (index: number) => void;
  reset: () => void;
  exportData: () => void;
}

const STORAGE_KEY = "ai-ticket-triage-demo-v1";

const DashboardContext = createContext<DashboardContextValue | null>(null);

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? JSON.parse(raw) : { reviews: {}, actions: [] };
  } catch {
    return { reviews: {}, actions: [] };
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

  const [saved, setSaved] = useState<SavedState>(loadSaved);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  if (query.isPending) return <div className="loading">Loading ticket data…</div>;

  if (query.isError) return <div className="loading">{query.error.message}</div>;

  const data = query.data;

  const review = (index: number): Review =>
    saved.reviews[`CH-${String(index + 1).padStart(2, "0")}`] ?? {
      status: "to_process",
      form: startingForm(data.proposals[index]),
    };

  const edit = (index: number, form: FormValues) => {
    const id = data.proposals[index].ticket_id;
    setSaved((current) => ({
      ...current,
      reviews: {
        ...current.reviews,
        [id]: { ...review(index), status: "in_review", form },
      },
    }));
  };

  const act = (index: number, action: string, reason = "") => {
    const proposal = data.proposals[index];
    const id = proposal.ticket_id;
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
        resolution_comment: `${form.assignee}: Could you clarify the requested outcome and affected service?`,
      };
    }

    const baseline = startingForm(proposal);

    // SAFETY: all own keys of FormValues are declared string-valued fields.
    const changedFields = (Object.keys(form) as (keyof FormValues)[]).flatMap((field) =>
      form[field] === baseline[field]
        ? []
        : [{ field, proposed: baseline[field], final: form[field] }],
    );

    const logEntry: Action = {
      ticket_id: id,
      action,
      timestamp: new Date().toISOString(),
      model_id: proposal.model_id,
      changed_fields: changedFields,
    };

    if (action === "escalate") logEntry.escalation_reason = reason;
    setSaved((state) => ({
      reviews: {
        ...state.reviews,
        [id]: { status, form, previous: { status: current.status, form: current.form } },
      },
      actions: [...state.actions, logEntry],
    }));
  };

  const undo = (index: number) => {
    const id = data.proposals[index].ticket_id;
    const current = review(index);

    if (!current.previous) return;
    const previous = current.previous;

    setSaved((state) => ({
      reviews: { ...state.reviews, [id]: previous },
      actions: [
        ...state.actions,
        {
          ticket_id: id,
          action: "undo",
          timestamp: new Date().toISOString(),
          model_id: data.proposals[index].model_id,
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
        review,
        edit,
        act,
        undo,
        reset: () => setSaved({ reviews: {}, actions: [] }),
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

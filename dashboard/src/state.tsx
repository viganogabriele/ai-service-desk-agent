import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Bundle, Outcome, Proposal, Status, Triage, TriageField } from "./domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HttpError,
  REASON_CODES,
  UNREACHABLE,
  coreActor,
  createBackendClient,
  levelOf,
  liveBundle,
  signedComment,
  ticketOutcome,
  ticketStatus,
  triagePatch,
} from "./lib/backend";
import type { CoreChange, SignedInUser, TicketPatch } from "./lib/backend";
import {
  LEVELS,
  OUTCOMES,
  RESOLUTIONS,
  STATUS_LABELS,
  TRIAGE_FIELDS,
  priority,
  serviceInfo,
  startingTriage,
  triageChanges,
} from "./domain";

/** Values the operator can confirm as reviewed without changing them: triage fields and the AI reply draft. */
export type Verifiable = TriageField | "reply";

export interface Review {
  status: Status;
  triage: Triage;
  reply: string;
  outcome: Outcome;
  question: string;
  // 0 is the bundled proposal; n is the n-th stronger-model regeneration.
  version: number;
  // AI values the operator explicitly confirmed. A later change makes the confirmation moot.
  verified?: Verifiable[];
  coreRunId?: string;
  updated_at?: string;
}

export interface Action {
  ticket_id: string;
  action: "assign" | "resolve" | "ask" | "move" | "reopen" | "regenerate";
  timestamp: string;
  model_id: string | null;
  // Fields the operator changed relative to the AI proposal, when one existed.
  changed_fields: { field: string; proposed: string | null; final: string | null }[];
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
  verify: (index: number, fields: Verifiable[], on: boolean) => Promise<void>;
  assign: (index: number, changes?: Editable) => void;
  resolve: (index: number, changes?: Editable) => void;
  askReporter: (index: number, changes?: Editable) => void;
  move: (index: number, status: "new" | "in_progress") => void;
  regenerate: (index: number, hint: string) => Promise<void>;
  reset: () => void;
  exportData: () => void;
  /** Sign in with Atlassian: null when the backend has it off (or is offline). */
  signIn: { user: SignedInUser | null; url: string; signOut: () => void } | null;
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
    content_clues?: string[];
  };
}

const STORAGE_KEY = "service-desk-reviews-v2";

const STRONGER_URL: string | null = import.meta.env.VITE_PREMIUM_SOLVER_URL || null;

// Through the dev server's proxy by default, so the backend's sign-in cookie is first-party.
const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL || "/api";

const backend = createBackendClient(BACKEND_URL);

const EMPTY: SavedState = { reviews: {}, actions: [], regenerated: {} };

interface Loaded {
  bundle: Bundle;
  // True when the backend was unreachable and the bundled data file is shown instead.
  offline: boolean;
}

/**
 * Development fallback: the data bundle prepared from the challenge files, used when the backend
 * is not running. Its records carry no Jira key, so the proposal id (or the position) becomes one.
 */
async function bundledData(signal: AbortSignal): Promise<Bundle> {
  const response = await fetch("/dashboard-data.json", { signal });

  if (!response.ok) throw new Error("The bundled data file is missing.");
  const bundle: Bundle = await response.json();

  return {
    ...bundle,
    challenge: bundle.challenge.map((ticket, index) => ({
      ...ticket,
      Key:
        ticket.Key ??
        bundle.proposals[index]?.ticket_id ??
        `CH-${String(index + 1).padStart(2, "0")}`,
      Urgency: levelOf(ticket.Urgency),
      Impact: levelOf(ticket.Impact),
    })),
  };
}

const NEXT_STATUS: Partial<Record<Action["action"], Status>> = {
  assign: "assigned",
  resolve: "resolved",
  ask: "waiting",
};

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
    content_clues: triage.content_clues ?? [],
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
    status: ticketStatus(ticket),
    triage: startingTriage(ticket, proposal),
    // The solver's draft is a resolution note, not a question, so it only pre-fills the reply.
    reply: aiResolution && aiResolution !== "clarification" ? draft : "",
    question: "",
    outcome: OUTCOMES.find((item) => item === aiResolution) ?? ticketOutcome(ticket),
    version,
    coreRunId: proposal?.core?.run_id,
    verified: coreReviewedFields(proposal),
  } satisfies Review;
}

function coreReviewedFields(proposal: Proposal | null): Verifiable[] {
  if (!proposal?.core) return [];

  return TRIAGE_FIELDS.filter(
    (field) =>
      proposal.core?.acceptedFields.includes(field) || proposal.explanations?.[field]?.pinned,
  );
}

// fetch rejects with a TypeError when the backend is down; the dev proxy answers 502 instead.
// A 502 from the backend itself (a failed sync, the Core) keeps its own message.
function unreachable(failure: Error) {
  return (
    failure instanceof TypeError || (failure instanceof HttpError && failure.code === UNREACHABLE)
  );
}

function failureText(failure: Error) {
  return unreachable(failure) ? `The backend at ${BACKEND_URL} is not reachable.` : failure.message;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const query = useQuery<Loaded>({
    queryKey: ["dashboard-data"],
    // The backend's copy of Jira; the backend syncs Jira in the background.
    queryFn: async ({ signal }) => {
      try {
        return { bundle: liveBundle(await backend.tickets(signal)), offline: false };
      } catch (failure) {
        if (!(failure instanceof Error) || !unreachable(failure)) throw failure;

        return { bundle: await bundledData(signal), offline: true };
      }
    },
    refetchInterval: (state) => (state.state.data?.offline ? false : 15_000),
  });

  // AI proposals from the Core. Without it the dashboard still works on Jira data alone.
  const core = useQuery({
    queryKey: ["core-proposals"],
    queryFn: ({ signal }) => backend.coreProposals(signal),
    // Offline there is no backend to proxy the Core.
    enabled: query.data?.offline === false,
    refetchInterval: 15_000,
    retry: false,
  });

  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: ({ signal }) => backend.auth(signal),
    enabled: query.data?.offline === false,
    retry: false,
  });

  const user = auth.data?.user ?? null;

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
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  if (query.isPending) return <div className="loading">Loading tickets…</div>;

  if (query.isError) return <div className="loading">{failureText(query.error)}</div>;

  const { bundle, offline } = query.data;

  // Online, the Core's proposals replace the bundle's (live bundles carry none).
  const data =
    !offline && core.data?.size
      ? {
          ...bundle,
          proposals: bundle.challenge.map((ticket) => core.data.get(ticket.Key) ?? null),
          proposal_source: { kind: "core" as const, path: null },
        }
      : bundle;

  const idOf = (index: number) => data.challenge[index].Key;

  const proposalAt = (index: number, version: number) =>
    version > 0
      ? (saved.regenerated[idOf(index)]?.[version - 1] ?? data.proposals[index])
      : data.proposals[index];

  // Edits are local drafts; the status always comes from Jira.
  const review = (index: number): Review => {
    const ticket = data.challenge[index];
    const draft = saved.reviews[idOf(index)];

    if (!draft) return initialReview(ticket, data.proposals[index]);

    if (offline) return draft;

    const runId = data.proposals[index]?.core?.run_id;

    return {
      ...draft,
      status: ticketStatus(ticket),
      verified:
        runId && draft.coreRunId !== runId
          ? coreReviewedFields(data.proposals[index])
          : [...new Set([...(draft.verified ?? []), ...coreReviewedFields(data.proposals[index])])],
      coreRunId: runId,
    };
  };

  const proposalFor = (index: number) => proposalAt(index, review(index).version);

  // The toast dismisses itself; see `Toast` in the root route.
  const show = (value: Notice) => setNotice(value);

  const write = (index: number, next: Review | null, entry?: Action) =>
    setSaved((state) => {
      const reviews = { ...state.reviews };

      if (next) reviews[idOf(index)] = next;
      else delete reviews[idOf(index)];

      return { ...state, reviews, actions: entry ? [...state.actions, entry] : state.actions };
    });

  const update = (index: number, changes: Editable) => {
    const current = review(index);

    write(index, { ...current, ...changes, updated_at: new Date().toISOString() });
  };

  const verify = async (index: number, fields: Verifiable[], on: boolean) => {
    const current = review(index);
    const proposal = proposalFor(index);
    const coreFields = fields.filter((field) => field !== "reply");

    if (on && proposal?.core && coreFields.length) {
      try {
        await backend.coreAccept(proposal.core, coreFields, coreActor(user));
      } catch (failure) {
        const error = failure instanceof Error ? failure : new Error(String(failure));

        show({ message: `Approval was not recorded in the Core: ${failureText(error)}` });

        return;
      }
    }

    const kept = (current.verified ?? []).filter((field) => !fields.includes(field));

    write(index, {
      ...current,
      verified: on ? [...kept, ...fields] : kept,
      status: offline && current.status === "new" ? "in_progress" : current.status,
      coreRunId: proposal?.core?.run_id,
      updated_at: new Date().toISOString(),
    });
  };

  const patchTickets = async (patches: TicketPatch[]) => {
    if (!auth.data || auth.isError)
      throw new Error("Your sign-in status could not be confirmed. Reload before saving.");

    try {
      const response = await backend.patch(patches, user);

      // Jira refusing a revoked token ends the session on the backend: show that it did.
      if (user && response.results.some((result) => !result.ok))
        await client.invalidateQueries({ queryKey: ["auth"] });

      return response;
    } catch (failure) {
      if (failure instanceof HttpError && (failure.status === 401 || failure.status === 409))
        await client.invalidateQueries({ queryKey: ["auth"] });
      throw failure;
    }
  };

  /** Apply a workflow transition, log it, and offer a one-step undo. */
  const transition = (
    index: number,
    action: Action["action"],
    message: string,
    changes: Editable = {},
    extra: { resolution?: TicketPatch["Resolution"]; comment?: string } = {},
  ) => {
    const ticket = data.challenge[index];
    const current = { ...review(index), ...changes };
    const proposal = proposalFor(index);
    const patch = triagePatch(ticket, current.triage);
    const comment = extra.comment?.trim();

    if (extra.resolution) patch.Resolution = extra.resolution;

    if (comment)
      patch["All Comments"] = [signedComment(comment, user?.email ?? current.triage.assignee)];

    const changedFields = proposal
      ? triageChanges(current.triage, startingTriage(ticket, proposal)).map((item) => ({
          field: item.field,
          proposed: item.before,
          final: item.after,
        }))
      : [];

    const entry: Action = {
      ticket_id: idOf(index),
      action,
      timestamp: new Date().toISOString(),
      model_id: proposal?.model_id ?? null,
      changed_fields: changedFields,
    };

    // Without a backend the transition is kept in this browser only.
    if (offline) {
      const status = NEXT_STATUS[action] ?? current.status;
      write(index, { ...current, status, updated_at: entry.timestamp }, entry);
      show({ message, undo: () => write(index, { ...current, status: current.status }) });

      return;
    }

    // The Core has no "unassigned": a cleared assignee is neither overridden nor accepted.
    const coreChanges: CoreChange[] = changedFields.flatMap(({ field, final }) =>
      field === "assignee" && !final
        ? []
        : [{ field, value: final, reason_code: REASON_CODES[field] }],
    );

    if (extra.resolution && extra.resolution !== proposal?.proposal.resolution)
      coreChanges.push({
        field: "resolution",
        value: extra.resolution,
        reason_code: REASON_CODES.resolution,
      });

    const approvalFields: (TriageField | "resolution")[] = [...TRIAGE_FIELDS];

    if (extra.resolution) approvalFields.push("resolution");

    const coreAccepted = approvalFields.filter(
      (field) =>
        (field === "resolution" || !current.verified?.includes(field)) &&
        !changedFields.some((item) => item.field === field) &&
        !coreChanges.some((change) => change.field === field),
    );

    write(index, { ...current, updated_at: new Date().toISOString() });

    void (async () => {
      try {
        const [result] = (await patchTickets([patch])).results;

        if (!result?.ok) throw new Error(result?.error ?? "Jira did not accept the change.");

        const recorded = proposal?.core
          ? await recordInCore(proposal.core, coreChanges, coreAccepted)
          : null;

        // Saved: drop the draft so the ticket shows what Jira now holds.
        write(index, null, entry);
        await Promise.all([
          client.invalidateQueries({ queryKey: ["dashboard-data"] }),
          client.invalidateQueries({ queryKey: ["core-proposals"] }),
        ]);
        show({
          message: [
            message,
            result.warnings.length ? `Jira noted: ${result.warnings.join("; ")}` : "",
            recorded ?? "",
          ]
            .filter(Boolean)
            .join(" "),
        });
      } catch (failure) {
        const error = failure instanceof Error ? failure : new Error(String(failure));

        show({ message: `${idOf(index)} was not saved to Jira: ${failureText(error)}` });
      }
    })();
  };

  /**
   * Tell the Core what the operator decided, after Jira has it: changed fields become
   * overrides, the rest are accepted. Returns a note when the Core could not record it.
   */
  const recordInCore = async (
    core: NonNullable<Proposal["core"]>,
    changes: CoreChange[],
    accepted: string[],
  ): Promise<string | null> => {
    try {
      if (changes.length) await backend.coreOverride(core, changes, coreActor(user));

      if (accepted.length) await backend.coreAccept(core, accepted, coreActor(user));

      return null;
    } catch (failure) {
      const error = failure instanceof Error ? failure : new Error(String(failure));

      return `The AI record was not updated: ${failureText(error)}`;
    }
  };

  /** Move an open ticket between New and In progress through a Jira transition. */
  const moveInJira = async (index: number, status: "new" | "in_progress") => {
    const id = idOf(index);

    try {
      const [result] = (
        await patchTickets([{ Key: id, Status: status === "in_progress" ? "in progress" : "open" }])
      ).results;

      if (!result?.ok) throw new Error(result?.error ?? "Jira did not accept the change.");

      setSaved((state) => ({
        ...state,
        actions: [
          ...state.actions,
          {
            ticket_id: id,
            action: "move",
            timestamp: new Date().toISOString(),
            model_id: null,
            changed_fields: [],
          },
        ],
      }));
      await client.invalidateQueries({ queryKey: ["dashboard-data"] });
      show({
        message: result.warnings.length
          ? `${id} was not moved: ${result.warnings.join("; ")}`
          : `${id} moved to ${STATUS_LABELS[status]}.`,
      });
    } catch (failure) {
      const error = failure instanceof Error ? failure : new Error(String(failure));

      show({ message: `${id} was not moved in Jira: ${failureText(error)}` });
    }
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
          ? [...ticket["All Comments"], signedComment(comment, user?.email ?? triage.assignee)]
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
        signIn: auth.data?.enabled
          ? {
              user,
              url: backend.signInUrl,
              signOut: () => {
                void backend
                  .signOut()
                  .then(() => client.invalidateQueries({ queryKey: ["auth"] }))
                  .catch(() => show({ message: "Sign out failed. Try again." }));
              },
            }
          : null,
        actions: saved.actions,
        stronger: {
          configured: STRONGER_URL !== null,
          online: health.isSuccess,
          model: health.data?.model ?? null,
        },
        notice,
        dismissNotice,
        idOf,
        review,
        proposalFor,
        update,
        verify,
        assign: (index, changes) =>
          transition(index, "assign", `${idOf(index)} assigned to ${team(index)}.`, changes),
        resolve: (index, changes) => {
          const current = { ...review(index), ...changes };

          transition(index, "resolve", `${idOf(index)} resolved.`, changes, {
            resolution: current.outcome,
            comment: current.reply,
          });
        },
        askReporter: (index, changes) => {
          const current = { ...review(index), ...changes };

          transition(
            index,
            "ask",
            `Question sent to ${data.challenge[index].Reporter}; ${idOf(index)} closed as Clarification.`,
            changes,
            { resolution: "clarification", comment: current.question },
          );
        },
        move: (index, status) => {
          if (offline) {
            write(index, { ...review(index), status, updated_at: new Date().toISOString() });

            return;
          }

          void moveInJira(index, status);
        },
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

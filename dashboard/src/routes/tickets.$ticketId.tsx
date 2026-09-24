import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import {
  IMPACT_LABELS,
  LEVELS,
  OUTCOME_LABELS,
  SERVICES,
  STATUS_LABELS,
  URGENCY_LABELS,
  aiValue,
  priority,
  serviceInfo,
} from "../domain";
import type { Ticket, Triage } from "../domain";
import {
  Initials,
  PriorityPill,
  SearchField,
  StatusFilter,
  StatusPill,
  isOpen,
  personName,
  useTicketRows,
} from "../components/tickets";
import { Select } from "../components/select";
import { CommentEditor, Dialog, OutcomePicker } from "../components/ui";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketWorkspace });

type Step = "resolve" | "ask" | "assign";

// Historical fixes are offered only when they match the request at least this closely.
const REFERENCE_SIMILARITY = 0.1;

const formatDate = (value: string) =>
  new Date(value.replace(" ", "T")).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function TicketWorkspace() {
  const { ticketId } = Route.useParams();

  return (
    <div className="workspace">
      <QueueRail ticketId={ticketId} />
      <TicketDetail key={ticketId} ticketId={ticketId} />
    </div>
  );
}

function QueueRail({ ticketId }: { ticketId: string }) {
  const { visible } = useTicketRows();

  return (
    <aside className="rail" aria-label="Ticket queue">
      <div className="rail-head">
        <Link to="/tickets" className="button ghost rail-back">
          <ArrowLeft size={16} strokeWidth={1.75} />
          All tickets
        </Link>
        <SearchField compact />
        <StatusFilter />
      </div>
      <div className="rail-list">
        {visible.map((row) => (
          <Link
            key={row.id}
            to="/tickets/$ticketId"
            params={{ ticketId: row.id }}
            className={row.id === ticketId ? "rail-item active" : "rail-item"}
          >
            <span className="rail-item-head">
              <span className="ticket-id">{row.id}</span>
              <PriorityPill triage={row.current.triage} />
            </span>
            <b>{row.ticket.Summary}</b>
            <small>
              {STATUS_LABELS[row.current.status]} · {row.current.triage.service}
            </small>
          </Link>
        ))}
        {visible.length === 0 && <p className="board-empty">No tickets match.</p>}
      </div>
    </aside>
  );
}

/** Explains where a field value differs from the AI suggestion or from what the reporter declared. */
function FieldNote({
  current,
  ai,
  declared,
  onUse,
}: {
  current: string;
  ai: string | null;
  declared: string | null;
  onUse: (value: string) => void;
}) {
  if (ai !== null && current !== ai)
    return (
      <span className="field-note">
        <Sparkles size={12} strokeWidth={1.75} />
        AI suggested {ai || "no assignee"}
        <button type="button" onClick={() => onUse(ai)}>
          Use
        </button>
      </span>
    );

  if (declared && current !== declared)
    return (
      <span className="field-note">
        {ai !== null && <Sparkles size={12} strokeWidth={1.75} />}
        {ai !== null ? "AI changed this from" : "Reporter declared"} {declared}
      </span>
    );

  return null;
}

function TicketDetail({ ticketId }: { ticketId: string }) {
  const {
    data,
    idOf,
    review,
    proposalFor,
    update,
    assign,
    resolve,
    askReporter,
    move,
    regenerate,
    stronger,
  } = useDashboard();

  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
  const index = data.challenge.findIndex((_, position) => idOf(position) === ticketId);
  const current = index >= 0 ? review(index) : null;
  const proposal = index >= 0 ? proposalFor(index) : null;

  const [step, setStep] = useState<Step>(() =>
    current?.status === "waiting" ||
    (current?.status === "new" && proposal?.proposal.resolution === "clarification")
      ? "ask"
      : "resolve",
  );

  const [strongerOpen, setStrongerOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historical, setHistorical] = useState<Ticket | null>(null);
  const order = visible.some((row) => row.index === index) ? visible : rows;
  const position = order.findIndex((row) => row.index === index);
  const previousId = order[position - 1]?.id;
  const nextId = order[position + 1]?.id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [role=listbox], .select, .modal")
      )
        return;

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.key === "j" ? nextId : event.key === "k" ? previousId : undefined;

      if (target) void navigate({ to: "/tickets/$ticketId", params: { ticketId: target } });
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, nextId, previousId]);

  if (index < 0 || !current)
    return (
      <div className="empty">
        Ticket not found. <Link to="/tickets">Back to tickets</Link>
      </div>
    );
  const ticket = data.challenge[index];
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "Unknown team";
  const level = priority(triage.urgency, triage.impact);
  const declaredService = ticket["Affected Business or IT Services"][0] ?? null;
  const candidates = proposal?.proposal.assignee_candidates ?? [];
  const aiDraft = proposal?.proposal.resolution_comment ?? "";

  const references = (data.similar[ticketId] ?? []).filter(
    (item) => item.service === triage.service && item.similarity >= REFERENCE_SIMILARITY,
  );

  const set = (changed: Partial<Triage>) => update(index, { triage: { ...triage, ...changed } });

  function goNext() {
    const next =
      order.find((row) => row.index !== index && isOpen(review(row.index).status)) ??
      rows.find((row) => row.index !== index && isOpen(review(row.index).status));

    if (next) void navigate({ to: "/tickets/$ticketId", params: { ticketId: next.id } });
  }

  async function askStronger() {
    setPending(true);
    setError(null);

    try {
      await regenerate(index, hint.trim());
      setStrongerOpen(false);
      setHint("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The stronger model could not produce a suggestion.",
      );
    } finally {
      setPending(false);
    }
  }

  const flags = [
    proposal?.review_flags.includes("assignee_low_confidence") && candidates[0]?.support
      ? `The assignee suggestion is weak: ${personName(candidates[0].email)} handled ${candidates[0].historical_count} of ${candidates[0].support} past tickets for this service and entity.`
      : "",
    proposal?.review_flags.includes("injection_removed")
      ? "Instruction-like text was removed from this ticket before the AI read it."
      : "",
  ].filter(Boolean);

  const levelOptions = (labels: string[]) =>
    LEVELS.map((value, place) => ({ value, label: value, hint: labels[place] }));

  // FieldNote hands back the AI's value as text; only known levels are applied.
  const applyUrgency = (value: string) => {
    const known = LEVELS.find((item) => item === value);

    if (known) set({ urgency: known });
  };

  const applyImpact = (value: string) => {
    const known = LEVELS.find((item) => item === value);

    if (known) set({ impact: known });
  };

  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...candidates.map((candidate) => ({
      value: candidate.email,
      label: personName(candidate.email),
      hint: candidate.support
        ? `${candidate.historical_count} of ${candidate.support} similar tickets`
        : candidate.email,
      group: "Suggested from history",
      icon: <Initials email={candidate.email} />,
    })),
    ...data.assignees
      .filter((email) => !candidates.some((candidate) => candidate.email === email))
      .map((email) => ({
        value: email,
        label: personName(email),
        hint: email,
        group: "All agents",
        icon: <Initials email={email} />,
      })),
  ];

  const closed = current.status === "resolved";

  return (
    <div className="detail">
      <div className="detail-heading">
        <div>
          <span className="utility">
            {ticketId} · {ticket["Request type"]}
          </span>
          <h1>{ticket.Summary}</h1>
          <p className="detail-meta">
            Reported by {personName(ticket.Reporter)} · {formatDate(ticket["Created date"])} ·{" "}
            {ticket["Business Entity"].join(", ")}
          </p>
          <div className="pill-row">
            <StatusPill status={current.status} />
            <PriorityPill triage={triage} />
            {info?.[2] === "Critical" && (
              <span className="pill">
                <i className="dot red" />
                Critical service
              </span>
            )}
          </div>
        </div>
        <div className="heading-meta">
          <span className="num">
            {position + 1} of {order.length}
          </span>
          <span className="kbd-hint" title="Keyboard: K previous, J next">
            <kbd>K</kbd>
            <kbd>J</kbd>
          </span>
          <Link
            to="/tickets/$ticketId"
            params={{ ticketId: previousId ?? ticketId }}
            className="icon-button"
            aria-label="Previous ticket"
            disabled={!previousId}
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </Link>
          <Link
            to="/tickets/$ticketId"
            params={{ ticketId: nextId ?? ticketId }}
            className="icon-button"
            aria-label="Next ticket"
            disabled={!nextId}
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </Link>
        </div>
      </div>

      <div className="grid">
        <section className="card span-5">
          <div className="card-head">
            <h2>Request</h2>
          </div>
          <p className="description">{ticket.Description}</p>
          <h3>Comments</h3>
          <div className="comments">
            {ticket["All Comments"].length ? (
              ticket["All Comments"].map((comment, place) => {
                const [author, ...rest] = comment.split(":");

                return (
                  <div key={place}>
                    <b>
                      <Initials email={author} />
                      {personName(author)}
                    </b>
                    <p>{rest.join(":").trim()}</p>
                  </div>
                );
              })
            ) : (
              <p className="muted">No comments.</p>
            )}
          </div>
          <h3>Details</h3>
          <dl className="details">
            <div>
              <dt>Reporter</dt>
              <dd>{ticket.Reporter}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{ticket["Due date"] ? formatDate(ticket["Due date"]) : "None"}</dd>
            </div>
            <div>
              <dt>Linked issues</dt>
              <dd>{ticket["Linked issues"].join(", ") || "None"}</dd>
            </div>
            <div>
              <dt>Declared priority</dt>
              <dd>
                {ticket.Priority} (Urgency {ticket.Urgency} × Impact {ticket.Impact})
              </dd>
            </div>
          </dl>
        </section>

        <div className="span-7 stack">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Triage</h2>
                <p>
                  {proposal
                    ? `Pre-filled by ${proposal.model_id}. Check each field; changes save automatically.`
                    : "No AI suggestion for this ticket. Fields start from what the reporter declared."}
                </p>
              </div>
              {stronger.configured && !closed && (
                <button
                  className="button"
                  aria-expanded={strongerOpen}
                  disabled={!stronger.online}
                  title={
                    stronger.online ? undefined : "The stronger model is currently unavailable"
                  }
                  onClick={() => setStrongerOpen(!strongerOpen)}
                >
                  <Sparkles size={16} strokeWidth={1.75} />
                  Ask a stronger model
                </button>
              )}
            </div>

            {strongerOpen && (
              <div className="inline-panel">
                <label className="textarea-label">
                  What should the model take into account?
                  <textarea
                    rows={3}
                    value={hint}
                    disabled={pending}
                    placeholder="For example: the reporter means NAV calculation, not fund pricing."
                    onChange={(event) => setHint(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="error-line" role="alert">
                    {error}
                  </p>
                )}
                <div className="panel-actions">
                  <button className="button ghost" onClick={() => setStrongerOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    disabled={pending || !hint.trim()}
                    onClick={() => void askStronger()}
                  >
                    {pending ? (
                      <LoaderCircle size={16} strokeWidth={1.75} className="spin" />
                    ) : (
                      <Sparkles size={16} strokeWidth={1.75} />
                    )}
                    {pending ? "Asking…" : "Get new suggestion"}
                  </button>
                </div>
              </div>
            )}

            {proposal?.rationale && (
              <blockquote className="ai-reason">{proposal.rationale}</blockquote>
            )}
            {flags.map((flag) => (
              <p className="flag" key={flag}>
                {flag}
              </p>
            ))}

            <div className="form-grid">
              <div className="field">
                Work type
                <div className="segmented full" role="group" aria-label="Work type">
                  {["Incident", "Service Request"].map((value) => (
                    <button
                      key={value}
                      aria-pressed={triage.work_type === value}
                      onClick={() => set({ work_type: value })}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <FieldNote
                  current={triage.work_type}
                  ai={aiValue(proposal, "work_type")}
                  declared={ticket["Work type"]}
                  onUse={(value) => set({ work_type: value })}
                />
              </div>
              <div className="field">
                <Select
                  label="Service"
                  value={triage.service}
                  onChange={(service) => set({ service })}
                  options={SERVICES.map(([name, owner, rating]) => ({
                    value: name,
                    label: name,
                    hint: owner,
                    group: `${rating} services`,
                  })).sort((a, b) => a.group.localeCompare(b.group))}
                />
                <FieldNote
                  current={triage.service}
                  ai={aiValue(proposal, "service")}
                  declared={declaredService}
                  onUse={(service) => set({ service })}
                />
              </div>
              <div className="field">
                Team
                <div className="readonly-value" title="Each service belongs to exactly one team">
                  <strong>{team}</strong>
                </div>
              </div>
              <div className="field">
                <Select
                  label="Assignee"
                  value={triage.assignee}
                  onChange={(assignee) => set({ assignee })}
                  options={assigneeOptions}
                  searchable
                />
                <FieldNote
                  current={triage.assignee}
                  ai={aiValue(proposal, "assignee")}
                  declared={null}
                  onUse={(assignee) => set({ assignee })}
                />
              </div>
              <div className="field">
                <Select
                  label="Urgency"
                  value={triage.urgency}
                  onChange={(urgency) => set({ urgency })}
                  options={levelOptions(URGENCY_LABELS)}
                />
                <FieldNote
                  current={triage.urgency}
                  ai={aiValue(proposal, "urgency")}
                  declared={ticket.Urgency}
                  onUse={applyUrgency}
                />
              </div>
              <div className="field">
                <Select
                  label="Impact"
                  value={triage.impact}
                  onChange={(impact) => set({ impact })}
                  options={levelOptions(IMPACT_LABELS)}
                />
                <FieldNote
                  current={triage.impact}
                  ai={aiValue(proposal, "impact")}
                  declared={ticket.Impact}
                  onUse={applyImpact}
                />
              </div>
            </div>
            <div className="priority-result">
              <span>Priority</span>
              <PriorityPill triage={triage} />
              <small>
                Set by the service desk matrix from urgency {triage.urgency} and impact{" "}
                {triage.impact}
                {level !== ticket.Priority && ` · reporter declared ${ticket.Priority}`}
              </small>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Next step</h2>
                <p>
                  Choose what happens to this ticket. The comment is posted to Jira as{" "}
                  {personName(triage.assignee) || "the assignee"}.
                </p>
              </div>
            </div>

            {current.status !== "new" && current.status !== "in_progress" && (
              <div className="status-banner">
                <CircleCheck size={16} strokeWidth={1.75} />
                <span>
                  {current.status === "resolved"
                    ? `Resolved as “${OUTCOME_LABELS[current.outcome]}”.`
                    : current.status === "waiting"
                      ? `Waiting for ${personName(ticket.Reporter)} to answer.`
                      : `Assigned to ${team}${triage.assignee ? ` · ${personName(triage.assignee)}` : ""}.`}
                </span>
                <button className="button ghost" onClick={() => move(index, "in_progress")}>
                  <RotateCcw size={14} strokeWidth={1.75} />
                  Reopen
                </button>
              </div>
            )}

            {!closed && (
              <>
                <div className="segmented full tabs" role="tablist" aria-label="Next step">
                  {(
                    [
                      ["resolve", "Resolve"],
                      ["ask", "Ask the reporter"],
                      ["assign", "Assign to team"],
                    ] satisfies [Step, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      aria-selected={step === value}
                      aria-pressed={step === value}
                      onClick={() => setStep(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {step === "resolve" && (
                  <div className="step">
                    <p className="step-help">
                      Closes the ticket with the outcome below and posts the note to the reporter.
                    </p>
                    <OutcomePicker
                      value={current.outcome}
                      onChange={(outcome) => update(index, { outcome })}
                    />
                    <CommentEditor
                      author={triage.assignee}
                      label="Resolution note"
                      placeholder="What was done, and how the reporter can confirm it is fixed."
                      value={current.reply}
                      onChange={(reply) => update(index, { reply })}
                    />
                    {aiDraft && current.reply === aiDraft && (
                      <p className="field-note">
                        <Sparkles size={12} strokeWidth={1.75} />
                        Draft written by {proposal?.model_id}. Review it before resolving.
                      </p>
                    )}
                    {references.length > 0 && (
                      <div className="references">
                        <h3>Documented fixes from similar resolved tickets</h3>
                        {references.slice(0, 3).map((item) => (
                          <article key={item.historical_index}>
                            <p>{item.resolution_text}</p>
                            <footer>
                              <span className="muted">
                                Used on {item.times_used} resolved {triage.service} ticket
                                {item.times_used === 1 ? "" : "s"}
                              </span>
                              <button
                                className="link-button"
                                onClick={() =>
                                  setHistorical(
                                    data.historical_examples[String(item.historical_index)],
                                  )
                                }
                              >
                                View ticket
                              </button>
                              <button
                                className="button"
                                onClick={() => update(index, { reply: item.resolution_text })}
                              >
                                Use as note
                              </button>
                            </footer>
                          </article>
                        ))}
                      </div>
                    )}
                    <div className="step-actions">
                      {!triage.assignee && <span className="muted">Choose an assignee first.</span>}
                      <button
                        className="button primary"
                        disabled={!triage.assignee || !current.reply.trim()}
                        onClick={() => {
                          resolve(index);
                          goNext();
                        }}
                      >
                        Resolve ticket
                      </button>
                    </div>
                  </div>
                )}

                {step === "ask" && (
                  <div className="step">
                    <p className="step-help">
                      Sends a question to {personName(ticket.Reporter)} and marks the ticket as
                      waiting for their answer.
                    </p>
                    {proposal?.proposal.resolution === "clarification" && (
                      <p className="field-note">
                        <Sparkles size={12} strokeWidth={1.75} />
                        The AI recommends asking the reporter before acting on this ticket.
                      </p>
                    )}
                    <CommentEditor
                      author={triage.assignee}
                      label="Question"
                      placeholder="What information do you need to continue?"
                      rows={4}
                      value={current.question}
                      onChange={(question) => update(index, { question })}
                    />
                    <div className="step-actions">
                      {!triage.assignee && <span className="muted">Choose an assignee first.</span>}
                      <button
                        className="button primary"
                        disabled={!triage.assignee || !current.question.trim()}
                        onClick={() => {
                          askReporter(index);
                          goNext();
                        }}
                      >
                        Send question
                      </button>
                    </div>
                  </div>
                )}

                {step === "assign" && (
                  <div className="step">
                    <p className="step-help">
                      Routes the ticket to <b>{team}</b>
                      {triage.assignee ? (
                        <>
                          {" "}
                          and assigns it to <b>{personName(triage.assignee)}</b>
                        </>
                      ) : (
                        " without a named assignee"
                      )}
                      . The ticket stays open for the team to work on.
                    </p>
                    <div className="step-actions">
                      <button
                        className="button primary"
                        disabled={current.status === "assigned"}
                        onClick={() => {
                          assign(index);
                          goNext();
                        }}
                      >
                        Assign ticket
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {historical && (
        <Dialog
          title={historical.Summary}
          description={`${historical["Affected Business or IT Services"].join(", ")} · resolved ${historical["Resolution date"] ? formatDate(historical["Resolution date"]) : ""}`}
          onClose={() => setHistorical(null)}
          footer={
            <button className="button" onClick={() => setHistorical(null)}>
              <X size={16} strokeWidth={1.75} />
              Close
            </button>
          }
        >
          <p className="description">{historical.Description}</p>
          <h3>Comments</h3>
          <div className="comments">
            {historical["All Comments"].map((comment, place) => {
              const [author, ...rest] = comment.split(":");

              return (
                <div key={place}>
                  <b>
                    <Initials email={author} />
                    {personName(author)}
                  </b>
                  <p>{rest.join(":").trim()}</p>
                </div>
              );
            })}
          </div>
        </Dialog>
      )}
    </div>
  );
}

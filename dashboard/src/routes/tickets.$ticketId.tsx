import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Info,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import type { Verifiable } from "../state";
import { OUTCOME_LABELS, STATUS_LABELS, serviceInfo } from "../domain";
import type { Ticket } from "../domain";
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
import {
  ClassificationSidebar,
  KindIcon,
  Reason,
  ReasonTooltip,
} from "../components/classification";
import type { TagKind } from "../components/classification";
import { CommentEditor, Dialog, OutcomePicker } from "../components/ui";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketWorkspace });

type Step = "resolve" | "ask" | "assign";

/* The reply starts as the model's draft and stays flagged until the operator approves or edits it. */
const DRAFT_FLAGS: Record<TagKind, string> = {
  ai: "AI draft · not reviewed yet",
  verified: "Approved by you",
  human: "Edited by you",
  declared: "",
  derived: "",
};

function draftKind(reply: string, draft: string, verified: readonly Verifiable[]): TagKind {
  if (reply.trim() !== draft.trim()) return "human";

  return verified.includes("reply") ? "verified" : "ai";
}

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
  const { data, idOf } = useDashboard();
  const index = data.challenge.findIndex((_, position) => idOf(position) === ticketId);

  if (index < 0)
    return (
      <div className="empty">
        Ticket not found. <Link to="/tickets">Back to tickets</Link>
      </div>
    );

  return (
    <div className="workspace">
      <QueueRail ticketId={ticketId} />
      <TicketDetail key={ticketId} ticketId={ticketId} index={index} />
      <ClassificationSidebar key={`classify-${ticketId}`} index={index} />
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

function TicketDetail({ ticketId, index }: { ticketId: string; index: number }) {
  const { data, review, proposalFor, update, verify, assign, resolve, askReporter, move } =
    useDashboard();

  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
  const current = review(index);
  const proposal = proposalFor(index);

  const [step, setStep] = useState<Step>(() =>
    current.status === "waiting" ||
    (current.status === "new" && proposal?.proposal.resolution === "clarification")
      ? "ask"
      : "resolve",
  );

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

  const ticket = data.challenge[index];
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "Unknown team";
  const aiDraft = proposal?.proposal.resolution_comment ?? "";
  const draft = aiDraft ? draftKind(current.reply, aiDraft, current.verified ?? []) : null;

  const references = (data.similar[ticketId] ?? []).filter(
    (item) => item.service === triage.service && item.similarity >= REFERENCE_SIMILARITY,
  );

  function goNext() {
    const next =
      order.find((row) => row.index !== index && isOpen(review(row.index).status)) ??
      rows.find((row) => row.index !== index && isOpen(review(row.index).status));

    if (next) void navigate({ to: "/tickets/$ticketId", params: { ticketId: next.id } });
  }

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
          <span className="kbd-hint" data-tip="Keyboard: K previous, J next">
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

      <div className="stack">
        <section className="card">
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
                    className={draft === "ai" ? "draft" : ""}
                  />
                  {draft && proposal && (
                    <div className={`draft-bar ${draft}`}>
                      <span className="draft-flag">
                        <KindIcon kind={draft} />
                        {DRAFT_FLAGS[draft]}
                      </span>
                      <ReasonTooltip
                        side="top"
                        align="start"
                        trigger={
                          <button className="link-button draft-why">
                            <Info size={14} strokeWidth={1.75} />
                            Why this draft
                          </button>
                        }
                      >
                        <Reason
                          title="Why this draft"
                          explanation={
                            proposal.explanations?.resolution_comment ?? {
                              reason:
                                proposal.rationale ||
                                "The model gave no reason for this suggestion.",
                              confidence: null,
                              evidence: [
                                `Suggested outcome: ${OUTCOME_LABELS[current.outcome]}`,
                                "Written for the assignee to post once the fix is confirmed",
                              ],
                            }
                          }
                          modelId={proposal.model_id}
                          footer="Edit the note or approve it as is"
                        />
                      </ReasonTooltip>
                      <span className="push">
                        {draft === "ai" && (
                          <button
                            className="button primary"
                            onClick={() => verify(index, ["reply"], true)}
                          >
                            <Check size={16} strokeWidth={2} />
                            Approve draft
                          </button>
                        )}
                        {draft === "verified" && (
                          <button
                            className="button ghost"
                            onClick={() => verify(index, ["reply"], false)}
                          >
                            Undo approval
                          </button>
                        )}
                        {draft === "human" && (
                          <button
                            className="button ghost"
                            onClick={() => update(index, { reply: aiDraft })}
                          >
                            <Undo2 size={16} strokeWidth={1.75} />
                            Restore AI draft
                          </button>
                        )}
                      </span>
                    </div>
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

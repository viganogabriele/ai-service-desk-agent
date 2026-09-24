import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Info,
  MessageCircleQuestion,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import type { Verifiable } from "../state";
import { OUTCOME_LABELS, serviceInfo } from "../domain";
import type { Ticket } from "../domain";
import {
  CriticalBadge,
  Initials,
  PriorityBadge,
  StatusPill,
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
import { CommentEditor, Dialog, Fold, OutcomePicker } from "../components/ui";

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

// Descriptions longer than this open folded to a few lines.
const LONG_DESCRIPTION = 420;

const formatDate = (value: string | null) =>
  value === null
    ? ""
    : new Date(value.replace(" ", "T")).toLocaleString("en-GB", {
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
      <QueueNav ticketId={ticketId} index={index} />
      <TicketDetail key={ticketId} ticketId={ticketId} index={index} />
      <ClassificationSidebar key={`classify-${ticketId}`} index={index} />
    </div>
  );
}

/** Previous and next walk the queue as it is filtered on the list page; J and K do the same. */
function QueueNav({ ticketId, index }: { ticketId: string; index: number }) {
  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
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

  return (
    <nav className="workspace-nav" aria-label="Queue">
      <Link to="/tickets" className="button ghost pill">
        <ArrowLeft size={16} strokeWidth={1.75} />
        All tickets
      </Link>
      <span className="position num">
        {position + 1} of {order.length}
      </span>
      <span className="push" />
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
    </nav>
  );
}

function Comments({ comments }: { comments: string[] }) {
  return (
    <div className="comments">
      {comments.map((comment, place) => {
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
  );
}

function TicketDetail({ ticketId, index }: { ticketId: string; index: number }) {
  const { data, review, proposalFor, update, verify, assign, resolve, askReporter, move } =
    useDashboard();

  const current = review(index);
  const proposal = proposalFor(index);

  const [step, setStep] = useState<Step>(() =>
    current.status === "waiting" ||
    (current.status === "new" && proposal?.proposal.resolution === "clarification")
      ? "ask"
      : "resolve",
  );

  const [historical, setHistorical] = useState<Ticket | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ticket = data.challenge[index];
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "Unknown team";
  const aiDraft = proposal?.proposal.resolution_comment ?? "";
  const draft = aiDraft ? draftKind(current.reply, aiDraft, current.verified ?? []) : null;
  const longDescription = ticket.Description.length > LONG_DESCRIPTION;

  const references = (data.similar[ticketId] ?? []).filter(
    (item) => item.service === triage.service && item.similarity >= REFERENCE_SIMILARITY,
  );

  const closed = current.status === "resolved";
  const decided = current.status !== "new" && current.status !== "in_progress";

  const choices: { value: Step; title: string; help: string; icon: typeof Send }[] = [
    {
      value: "resolve",
      title: "Resolve",
      help: "Close it and post a note to the reporter",
      icon: CircleCheck,
    },
    {
      value: "ask",
      title: "Ask the reporter",
      help: `Send ${personName(ticket.Reporter)} a question and wait`,
      icon: MessageCircleQuestion,
    },
    {
      value: "assign",
      title: "Assign to team",
      help: `Route it to ${team} to work on`,
      icon: Users,
    },
  ];

  return (
    <div className="detail">
      <header className="detail-heading">
        <div className="marks">
          <PriorityBadge triage={triage} />
          {info?.[2] === "Critical" && <CriticalBadge />}
          <StatusPill status={current.status} />
          <span className="ticket-id">
            {ticketId} · {ticket["Request type"] ?? ticket["Work type"]}
          </span>
        </div>
        <h1>{ticket.Summary}</h1>
        <div className="tiles">
          <div className="tile">
            <span className="tile-label">
              <UserRound size={12} strokeWidth={2} />
              Requested by
            </span>
            <span className="tile-value" data-tip={ticket.Reporter ?? undefined}>
              <Initials email={ticket.Reporter} />
              <span>{personName(ticket.Reporter) || "Unknown"}</span>
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">
              <CalendarClock size={12} strokeWidth={2} />
              Opened
            </span>
            <span className="tile-value">
              <span>{formatDate(ticket["Created date"]) || "Unknown"}</span>
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">
              <Building2 size={12} strokeWidth={2} />
              Entity
            </span>
            <span className="tile-value">
              <span>{ticket["Business Entity"].join(", ") || "None"}</span>
            </span>
          </div>
          {ticket["Due date"] && (
            <div className="tile">
              <span className="tile-label">
                <CalendarClock size={12} strokeWidth={2} />
                Due
              </span>
              <span className="tile-value">
                <span>{formatDate(ticket["Due date"])}</span>
              </span>
            </div>
          )}
        </div>
      </header>

      <section className="card step-card" aria-label="Request">
        <div className="step-body">
          <p className={longDescription && !expanded ? "description clamped" : "description"}>
            {ticket.Description}
          </p>
          {longDescription && (
            <div>
              <button className="link-button" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show less" : "Read the full request"}
              </button>
            </div>
          )}
        </div>
        <Fold
          icon={<MessageSquare size={16} strokeWidth={1.75} />}
          title="Comments"
          count={ticket["All Comments"].length}
        >
          {ticket["All Comments"].length ? (
            <Comments comments={ticket["All Comments"]} />
          ) : (
            <p className="muted">No comments yet.</p>
          )}
        </Fold>
        <Fold icon={<Info size={16} strokeWidth={1.75} />} title="Jira details">
          <dl className="details">
            <div>
              <dt>Reporter</dt>
              <dd>{ticket.Reporter}</dd>
            </div>
            <div>
              <dt>Linked issues</dt>
              <dd>{ticket["Linked issues"].join(", ") || "None"}</dd>
            </div>
            <div>
              <dt>Declared priority</dt>
              <dd>
                {ticket.Priority ?? "None"} (Urgency {ticket.Urgency ?? "unknown"} × Impact{" "}
                {ticket.Impact ?? "unknown"})
              </dd>
            </div>
            <div>
              <dt>Declared service</dt>
              <dd>{ticket["Affected Business or IT Services"].join(", ") || "None"}</dd>
            </div>
          </dl>
        </Fold>
      </section>

      <section className="card step-card" aria-label="Next step">
        <div className="step-head">
          <span className={decided ? "step-number done" : "step-number"}>
            {decided ? <Check size={14} strokeWidth={2.5} /> : "2"}
          </span>
          <div>
            <h2>Decide the next step</h2>
            <p>Comments are posted to Jira as {personName(triage.assignee) || "the assignee"}.</p>
          </div>
        </div>
        <div className="step-body">
          {decided && (
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
              <div className="choices" role="radiogroup" aria-label="Next step">
                {choices.map(({ value, title, help, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    className="choice"
                    aria-checked={step === value}
                    onClick={() => setStep(value)}
                  >
                    <b>
                      <Icon size={16} strokeWidth={1.75} />
                      {title}
                    </b>
                    <small>{help}</small>
                    {value === "ask" && proposal?.proposal.resolution === "clarification" && (
                      <span className="hint">
                        <Sparkles size={11} strokeWidth={2} />
                        AI recommends this
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {step === "resolve" && (
                <>
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
                          <button className="button" onClick={() => verify(index, ["reply"], true)}>
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
                      <Fold
                        icon={<BookOpen size={16} strokeWidth={1.75} />}
                        title="Fixes from similar resolved tickets"
                        count={Math.min(references.length, 3)}
                      >
                        <div className="references">
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
                      </Fold>
                    </div>
                  )}
                  <div className="step-actions">
                    {!triage.assignee && <span className="muted">Choose an assignee first.</span>}
                    <button
                      className="button primary large"
                      disabled={!triage.assignee || !current.reply.trim()}
                      onClick={() => resolve(index)}
                    >
                      <CircleCheck size={16} strokeWidth={2} />
                      Resolve ticket
                    </button>
                  </div>
                </>
              )}

              {step === "ask" && (
                <>
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
                      className="button primary large"
                      disabled={!triage.assignee || !current.question.trim()}
                      onClick={() => askReporter(index)}
                    >
                      <Send size={16} strokeWidth={2} />
                      Send question
                    </button>
                  </div>
                </>
              )}

              {step === "assign" && (
                <>
                  <p className="description">
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
                      className="button primary large"
                      disabled={current.status === "assigned"}
                      onClick={() => assign(index)}
                    >
                      <Users size={16} strokeWidth={2} />
                      Assign ticket
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

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
          <Comments comments={historical["All Comments"]} />
        </Dialog>
      )}
    </div>
  );
}

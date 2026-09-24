import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  History,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import {
  ESCALATION_REASONS,
  IMPACT_LABELS,
  LEVELS,
  PRIORITY_MATRIX,
  RESOLUTIONS,
  SERVICES,
  STATUS_LABELS,
  URGENCY_LABELS,
  commentBody,
  confidenceLabel,
  formChanges,
  priority,
  reviewWarnings,
  serviceInfo,
  startingForm,
} from "../domain";
import type { FormValues, Ticket } from "../domain";
import {
  PriorityPill,
  SearchField,
  StatusPill,
  StatusSelect,
  isOpen,
  useTicketRows,
} from "../components/tickets";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketWorkspace });

type Panel = "escalate" | "clarify" | "premium" | null;

function OriginalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="original-field">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

function Diff({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <p className="diff">
      <span>{label}</span>
      <span>
        <span className={before === after ? "" : "old-value"}>{before}</span>
        <span className="change-arrow">→</span>
        {after}
      </span>
    </p>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const ACTION_LABELS = new Map([
  ["accept", "Accepted proposal"],
  ["modify", "Modified & accepted"],
  ["escalate", "Escalated"],
  ["clarify", "Requested clarification"],
  ["regenerate", "Regenerated with premium model"],
  ["undo", "Undid last action"],
]);

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
        <StatusSelect />
      </div>
      <div className="rail-list">
        {visible.map((row) => (
          <Link
            key={row.proposal.ticket_id}
            to="/tickets/$ticketId"
            params={{ ticketId: row.proposal.ticket_id }}
            className={row.proposal.ticket_id === ticketId ? "rail-item active" : "rail-item"}
          >
            <span className="rail-item-head">
              <span className="ticket-id">{row.proposal.ticket_id}</span>
              <StatusPill status={row.current.status} />
            </span>
            <b>{row.ticket.Summary}</b>
            <small>
              {row.current.form.service} ·{" "}
              {priority(row.current.form.urgency, row.current.form.impact)}
            </small>
          </Link>
        ))}
        {visible.length === 0 && <p className="board-empty">No tickets match.</p>}
      </div>
    </aside>
  );
}

function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data, review, proposalFor, history, actions, edit, act, regenerate, undo, premium } =
    useDashboard();

  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
  const index = data.proposals.findIndex((item) => item.ticket_id === ticketId);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState<string>(ESCALATION_REASONS[0]);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [hint, setHint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const order = visible.some((row) => row.index === index) ? visible : rows;
  const position = order.findIndex((row) => row.index === index);
  const previousId = order[position - 1]?.proposal.ticket_id;
  const nextId = order[position + 1]?.proposal.ticket_id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select"))
        return;

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.key === "j" ? nextId : event.key === "k" ? previousId : undefined;

      if (target) void navigate({ to: "/tickets/$ticketId", params: { ticketId: target } });

      if (event.key === "Escape") setPanel(null);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, nextId, previousId]);

  if (index < 0)
    return (
      <div className="empty">
        Ticket not found. <Link to="/tickets">Return to tickets</Link>
      </div>
    );
  const ticket = data.challenge[index];
  const proposal = proposalFor(index);
  const versions = history(index);
  const current = review(index);
  const form = current.form;
  const baseline = startingForm(proposal);
  const info = serviceInfo(form.service);
  const team = info?.[1] ?? "Unknown service";
  const computedPriority = priority(form.urgency, form.impact);
  const changes = formChanges(form, baseline);
  const warnings = reviewWarnings(ticket, form);
  const body = commentBody(form.resolution_comment);
  const log = actions.filter((item) => item.ticket_id === ticketId).reverse();
  const reporterName = ticket.Reporter.split("@")[0].split(".")[0];

  const templates = [
    {
      label: "Resolution summary",
      text: `Diagnosis: ${ticket.Summary}. Action: … Validation: confirmed with ${ticket.Reporter} that ${form.service} works as expected.`,
    },
    {
      label: "Access granted",
      text: `Access to ${form.service} was granted with the standard role requested for ${ticket.Reporter}; the user confirmed they can sign in and complete the task.`,
    },
    {
      label: "Workaround",
      text: `Workaround provided for ${form.service}: … A permanent fix is tracked by ${team}; please reopen if the workaround stops working.`,
    },
  ];

  function update(changed: Partial<FormValues>) {
    edit(index, { ...form, ...changed });
  }

  function goNext() {
    const next =
      order.find((row) => row.index !== index && isOpen(review(row.index).status)) ??
      rows.find((row) => row.index !== index && isOpen(review(row.index).status));

    if (next)
      void navigate({ to: "/tickets/$ticketId", params: { ticketId: next.proposal.ticket_id } });
  }

  function finish(action: string, options?: { reason?: string; message?: string }) {
    act(index, action, options);
    setPanel(null);
    goNext();
  }

  async function askPremium() {
    setPending(true);
    setError(null);

    try {
      await regenerate(index, hint.trim());
      setPanel(null);
      setHint("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Regeneration failed");
    } finally {
      setPending(false);
    }
  }

  const premiumReady = premium.url !== null && premium.online;

  return (
    <>
      <div className="detail">
        <div className="detail-heading">
          <div>
            <span className="utility">
              {ticketId} · {ticket["Request type"]}
            </span>
            <h1>{ticket.Summary}</h1>
            <div className="pill-row">
              <StatusPill status={current.status} />
              <PriorityPill row={{ index, ticket, proposal, current }} />
              <span className="pill">{form.work_type}</span>
              <span className="pill">
                <i className={`dot ${info?.[2] === "Critical" ? "red" : ""}`} />
                {info?.[2] ?? "Unknown"} service
              </span>
              {versions.length > 0 && (
                <span className="pill">
                  <Sparkles size={12} strokeWidth={1.75} />
                  Version {current.version ?? 0} of {versions.length}
                </span>
              )}
            </div>
          </div>
          <div className="heading-meta">
            <span className="num">
              {position + 1} / {order.length}
            </span>
            <span className="kbd-hint">
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

        <div className="action-bar">
          <button
            className="button primary"
            onClick={() => finish(changes.length ? "modify" : "accept")}
          >
            <Check size={16} strokeWidth={1.75} />
            {changes.length
              ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""} & resolve`
              : "Accept & resolve"}
          </button>
          <button
            className="button"
            aria-expanded={panel === "escalate"}
            onClick={() => setPanel(panel === "escalate" ? null : "escalate")}
          >
            <TriangleAlert size={16} strokeWidth={1.75} />
            Escalate to L3
          </button>
          <button
            className="button"
            aria-expanded={panel === "clarify"}
            onClick={() => {
              setQuestion(
                `Hi ${reporterName}, could you clarify the requested outcome and confirm which service is affected?`,
              );
              setPanel(panel === "clarify" ? null : "clarify");
            }}
          >
            <CircleHelp size={16} strokeWidth={1.75} />
            Ask clarification
          </button>
          <button
            className="button"
            aria-expanded={panel === "premium"}
            onClick={() => setPanel(panel === "premium" ? null : "premium")}
          >
            <Sparkles size={16} strokeWidth={1.75} />
            Ask a stronger model
          </button>
          <button
            className="button ghost push"
            disabled={!current.previous}
            onClick={() => undo(index)}
          >
            <Undo2 size={16} strokeWidth={1.75} />
            Undo
          </button>
        </div>

        {panel === "escalate" && (
          <section className="card panel" aria-label="Escalate ticket">
            <div className="card-head">
              <div>
                <h2>Escalate to L3 · {team}</h2>
                <p>The ticket leaves the L2 queue with the current classification and your note.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setPanel(null)}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="choice-row" role="radiogroup" aria-label="Escalation reason">
              {ESCALATION_REASONS.map((item) => (
                <button
                  key={item}
                  role="radio"
                  aria-checked={reason === item}
                  className="choice"
                  onClick={() => setReason(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="textarea-label">
              Note for the next level {reason === "Other" && "(required)"}
              <textarea
                rows={3}
                value={note}
                placeholder="What have you checked, and what should L3 look at first?"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={reason === "Other" && !note.trim()}
                onClick={() =>
                  finish("escalate", {
                    reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
                    message: note.trim() || undefined,
                  })
                }
              >
                Escalate ticket
              </button>
            </div>
          </section>
        )}

        {panel === "clarify" && (
          <section className="card panel" aria-label="Ask clarification">
            <div className="card-head">
              <div>
                <h2>Ask {ticket.Reporter} for clarification</h2>
                <p>Sets Resolution to “clarification” and posts this question as the comment.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setPanel(null)}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <label className="textarea-label">
              Question
              <textarea
                rows={3}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={!question.trim()}
                onClick={() => finish("clarify", { message: question.trim() })}
              >
                <MessageSquareText size={16} strokeWidth={1.75} />
                Send request
              </button>
            </div>
          </section>
        )}

        {panel === "premium" && (
          <section className="card panel" aria-label="Ask a stronger model">
            <div className="card-head">
              <div>
                <h2>Ask a stronger model</h2>
                <p>
                  {premium.url
                    ? premium.online
                      ? `Re-runs triage on ${premium.model} with your hint. The current proposal stays in the history.`
                      : `The premium solver at ${premium.url} is not reachable.`
                    : "No premium solver is configured. Start one with `python -m triage_poc --model <larger model> serve --port 8766` and set VITE_PREMIUM_SOLVER_URL=http://127.0.0.1:8766."}
                </p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setPanel(null)}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <label className="textarea-label">
              Hint for the model (required)
              <textarea
                rows={3}
                value={hint}
                disabled={!premiumReady || pending}
                placeholder="e.g. The description is about NAV calculation, not fund pricing; urgency is higher because month-end is today."
                onChange={(event) => setHint(event.target.value)}
              />
            </label>
            {error && (
              <p className="error-line" role="alert">
                {error}
              </p>
            )}
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={!premiumReady || pending || !hint.trim()}
                onClick={() => void askPremium()}
              >
                {pending ? (
                  <LoaderCircle size={16} strokeWidth={1.75} className="spin" />
                ) : (
                  <Sparkles size={16} strokeWidth={1.75} />
                )}
                {pending ? "Regenerating…" : "Regenerate proposal"}
              </button>
            </div>
          </section>
        )}

        <div className="grid">
          <section className="card span-5">
            <div className="card-head">
              <div>
                <h2>Request</h2>
                <p>Read only · incoming Jira record</p>
              </div>
            </div>
            <p className="description">{ticket.Description}</p>
            <h3>Declared fields</h3>
            <div className="original-fields">
              <OriginalField label="Work type" value={ticket["Work type"]} />
              <OriginalField
                label="Service"
                value={ticket["Affected Business or IT Services"].join(", ")}
              />
              <OriginalField
                label="Urgency / Impact / Priority"
                value={`${ticket.Urgency} / ${ticket.Impact} / ${ticket.Priority}`}
              />
              <OriginalField label="Business entity" value={ticket["Business Entity"].join(", ")} />
              <OriginalField label="Reporter" value={ticket.Reporter} />
              <OriginalField label="Created" value={ticket["Created date"]} />
              <OriginalField label="Due date" value={ticket["Due date"]} />
              <OriginalField label="Linked issues" value={ticket["Linked issues"].join(", ")} />
            </div>
            <h3>Comments</h3>
            <div className="comments">
              {ticket["All Comments"].length ? (
                ticket["All Comments"].map((comment, place) => {
                  const [author, ...rest] = comment.split(":");

                  return (
                    <div key={place}>
                      <b>
                        <i className="dot" />
                        {author}
                      </b>
                      <p>{rest.join(":").trim()}</p>
                    </div>
                  );
                })
              ) : (
                <p className="muted">No comments.</p>
              )}
            </div>
          </section>

          <div className="span-7 stack">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>
                    Triage decision
                    {data.mock && <span className="mock-mini">Mock</span>}
                  </h2>
                  <p>
                    Proposed by {proposal.model_id} · {STATUS_LABELS[current.status].toLowerCase()}
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  Work type
                  <div className="segmented full" role="group" aria-label="Work type">
                    {["Incident", "Service Request"].map((value) => (
                      <button
                        key={value}
                        aria-pressed={form.work_type === value}
                        onClick={() => update({ work_type: value })}
                      >
                        {value}
                        {value === form.work_type && value !== ticket["Work type"] && (
                          <em className="tag">changed</em>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  Service
                  <select
                    value={form.service}
                    onChange={(event) => update({ service: event.target.value })}
                  >
                    {SERVICES.map(([name, , tier]) => (
                      <option key={name} value={name}>
                        {name} · {tier}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  Team
                  <div className="readonly-value">
                    <strong>{team}</strong>
                    <span className="muted">derived</span>
                  </div>
                </div>
                <label>
                  Assignee
                  <select
                    value={form.assignee}
                    onChange={(event) =>
                      update({
                        assignee: event.target.value,
                        resolution_comment: `${event.target.value}: ${body}`,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {proposal.proposal.assignee_candidates.map((candidate) => (
                      <option value={candidate.email} key={candidate.email}>
                        {candidate.email} · {candidate.historical_count} in team
                      </option>
                    ))}
                    {data.assignees
                      .filter(
                        (email) =>
                          !proposal.proposal.assignee_candidates.some(
                            (candidate) => candidate.email === email,
                          ),
                      )
                      .map((email) => (
                        <option value={email} key={email}>
                          {email}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Urgency
                  <select
                    value={form.urgency}
                    onChange={(event) =>
                      update({
                        urgency:
                          LEVELS.find((level) => level === event.target.value) ?? form.urgency,
                      })
                    }
                  >
                    {LEVELS.map((level, place) => (
                      <option value={level} key={level}>
                        {level} — {URGENCY_LABELS[place]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Impact
                  <select
                    value={form.impact}
                    onChange={(event) =>
                      update({
                        impact: LEVELS.find((level) => level === event.target.value) ?? form.impact,
                      })
                    }
                  >
                    {LEVELS.map((level, place) => (
                      <option value={level} key={level}>
                        {level} — {IMPACT_LABELS[place]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  Priority
                  <div className="readonly-value">
                    <strong>{computedPriority}</strong>
                    <span className="muted">calculated</span>
                  </div>
                </div>
                <label>
                  Resolution
                  <select
                    value={form.resolution}
                    onChange={(event) =>
                      update({
                        resolution:
                          RESOLUTIONS.find((value) => value === event.target.value) ??
                          form.resolution,
                      })
                    }
                  >
                    {RESOLUTIONS.map((value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="matrix">
                <span>Priority matrix · urgency rows × impact columns</span>
                <div className="matrix-grid">
                  {PRIORITY_MATRIX.flatMap((row, urgencyIndex) =>
                    row.map((level, impactIndex) => (
                      <div
                        key={`${urgencyIndex}-${impactIndex}`}
                        className={
                          form.urgency === LEVELS[urgencyIndex] &&
                          form.impact === LEVELS[impactIndex]
                            ? "selected"
                            : ""
                        }
                        title={`${LEVELS[urgencyIndex]} urgency / ${LEVELS[impactIndex]} impact`}
                      >
                        {level}
                      </div>
                    )),
                  )}
                </div>
              </div>
              {warnings.length > 0 && (
                <div className="warnings" role="status">
                  <b>
                    <TriangleAlert size={16} strokeWidth={1.75} />
                    Review warnings
                  </b>
                  {warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Response</h2>
                  <p>Posted to the ticket as the resolution comment when you resolve it.</p>
                </div>
                <span className={body.length < 40 ? "count warn" : "count"}>
                  {body.length} chars
                </span>
              </div>
              <div className="template-row">
                {templates.map((template) => (
                  <button
                    key={template.label}
                    className="chip"
                    onClick={() =>
                      update({ resolution_comment: `${form.assignee}: ${template.text}` })
                    }
                  >
                    {template.label}
                  </button>
                ))}
                {body !== commentBody(baseline.resolution_comment) && (
                  <button
                    className="chip ghost"
                    onClick={() =>
                      update({
                        resolution_comment: `${form.assignee}: ${commentBody(baseline.resolution_comment)}`,
                      })
                    }
                  >
                    Restore AI draft
                  </button>
                )}
              </div>
              <div className="composer">
                <span className="composer-author">
                  <i className="dot accent" />
                  {form.assignee || "Unassigned"}
                </span>
                <textarea
                  rows={5}
                  aria-label="Response text"
                  value={body}
                  onChange={(event) =>
                    update({ resolution_comment: `${form.assignee}: ${event.target.value}` })
                  }
                />
              </div>
            </section>
          </div>
        </div>

        <div className="grid">
          <section className="card span-6">
            <div className="card-head">
              <h2>
                AI rationale{" "}
                {data.mock && proposal.model_id.startsWith("mock") && (
                  <span className="mock-mini">Mock</span>
                )}
              </h2>
            </div>
            <div className="confidence">
              {(["work_type", "service"] as const).map((field) => {
                const value = proposal.confidence[field];

                return (
                  <div key={field}>
                    <span>
                      {field === "service" ? "Service" : "Work type"}
                      <span>{confidenceLabel(value)}</span>
                    </span>
                    <b>{value === null ? "—" : `${Math.round(value * 100)}%`}</b>
                    <div className="meter">
                      <span style={{ width: `${(value ?? 0) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="rationale">{proposal.rationale}</p>
            {proposal.latency_ms != null && (
              <p className="card-note">Generated in {(proposal.latency_ms / 1000).toFixed(1)} s</p>
            )}
            <h3>Proposal vs declared</h3>
            <Diff
              label="Service"
              before={ticket["Affected Business or IT Services"][0]}
              after={proposal.proposal.service}
            />
            <Diff
              label="Work type"
              before={ticket["Work type"]}
              after={proposal.proposal.work_type}
            />
            <Diff
              label="Urgency / impact"
              before={`${ticket.Urgency} / ${ticket.Impact}`}
              after={`${proposal.proposal.urgency} / ${proposal.proposal.impact}`}
            />
            <h3>Your changes</h3>
            {changes.length ? (
              changes.map((item) => (
                <Diff
                  key={item.field}
                  label={item.field.replace("_", " ")}
                  before={item.field === "resolution_comment" ? "AI draft" : item.before}
                  after={item.field === "resolution_comment" ? "edited" : item.after}
                />
              ))
            ) : (
              <p className="muted">No operator changes yet.</p>
            )}
          </section>
          <div className="span-6 stack">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>
                    Similar historical tickets{" "}
                    {data.mock && <span className="mock-mini">Mock</span>}
                  </h2>
                  <p>Example matches by service; similarity has not been measured.</p>
                </div>
              </div>
              {proposal.similar_tickets.map((item) => (
                <button
                  className="similar"
                  key={item.historical_index}
                  onClick={() =>
                    setSelected(data.historical_examples[String(item.historical_index)])
                  }
                >
                  <History size={16} strokeWidth={1.75} className="muted" />
                  <span>
                    <b>{item.summary}</b>
                    <small>
                      {item.service} · {item.resolution}
                      {item.similarity === null
                        ? ""
                        : ` · ${Math.round(item.similarity * 100)}% similar`}
                    </small>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} />
                </button>
              ))}
            </section>
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Activity</h2>
                  <p>Append-only action log for {ticketId}</p>
                </div>
              </div>
              {log.length ? (
                <ol className="timeline">
                  {log.map((item) => (
                    <li key={`${item.timestamp}-${item.action}`}>
                      <b>{ACTION_LABELS.get(item.action) ?? item.action}</b>
                      <small>
                        {time(item.timestamp)} · {item.model_id}
                      </small>
                      {item.escalation_reason && <p>{item.escalation_reason}</p>}
                      {item.hint && <p>Hint: {item.hint}</p>}
                      {item.action === "clarify" && item.message && <p>{item.message}</p>}
                      {item.changed_fields.length > 0 && (
                        <p className="muted">
                          Changed{" "}
                          {item.changed_fields
                            .map((change) => change.field.replace("_", " "))
                            .join(", ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No actions yet.</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {selected && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Historical ticket"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{selected.Summary}</h2>
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <p>{selected.Description}</p>
            <div className="original-fields">
              <OriginalField
                label="Service"
                value={selected["Affected Business or IT Services"].join(", ")}
              />
              <OriginalField label="Team" value={selected["Service Team(s)"].join(", ")} />
              <OriginalField label="Resolution" value={selected.Resolution} />
              <OriginalField label="Assignee" value={selected.Assignee} />
            </div>
            <h3>Comments</h3>
            <div className="comments">
              {selected["All Comments"].map((comment, place) => (
                <div key={place}>
                  <p>{comment}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

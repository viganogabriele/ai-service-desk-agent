import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useDashboard } from "../state";
import {
  IMPACT_LABELS,
  LEVELS,
  PRIORITY_MATRIX,
  RESOLUTIONS,
  SERVICES,
  URGENCY_LABELS,
  priority,
  serviceInfo,
  startingForm,
} from "../domain";
import type { FormValues, Ticket } from "../domain";

export const Route = createFileRoute("/ticket/$ticketId")({ component: TicketView });

function OriginalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="original-field">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

function confidenceLabel(value: number) {
  return value >= 0.8 ? "High" : value >= 0.5 ? "Medium" : "Low";
}

function TicketView() {
  const { ticketId } = Route.useParams();
  const { data, review, edit, act, undo } = useDashboard();
  const navigate = useNavigate();
  const index = data.proposals.findIndex((item) => item.ticket_id === ticketId);
  const [selected, setSelected] = useState<Ticket | null>(null);

  if (index < 0)
    return (
      <div className="empty">
        Ticket not found. <Link to="/">Return to queue</Link>
      </div>
    );
  const ticket = data.challenge[index];
  const proposal = data.proposals[index];
  const current = review(index);
  const form = current.form;
  const baseline = startingForm(proposal);
  const team = serviceInfo(form.service)?.[1] ?? "Unknown service";
  const rating = serviceInfo(form.service)?.[2];
  const computedPriority = priority(form.urgency, form.impact);

  // SAFETY: all own keys of FormValues are declared string-valued fields.
  const changes = (Object.keys(form) as (keyof FormValues)[]).flatMap((field) =>
    form[field] === baseline[field] ? [] : [{ field, before: baseline[field], after: form[field] }],
  );

  const warnings = [
    rating === "Critical" && ["Low", "Lowest"].includes(computedPriority)
      ? "Critical service with low priority"
      : "",
    form.resolution_comment.split(":").slice(1).join(":").trim().length < 40 ||
    /^(fixed|problem fixed|resolution recorded)$/i.test(
      form.resolution_comment.split(":").slice(1).join(":").trim(),
    )
      ? "Resolution comment needs more detail"
      : "",
    ticket["Request type"] === "Nonsense / Unclear Input" && form.resolution !== "clarification"
      ? "Unclear input should request clarification"
      : "",
    !form.assignee ? "Assignee is empty" : "",
  ].filter(Boolean);

  function update(changed: Partial<FormValues>) {
    edit(index, { ...form, ...changed });
  }

  function finish(action: string, reason?: string) {
    act(index, action, reason);

    const next = data.proposals.findIndex(
      (_, position) =>
        position !== index &&
        !["accepted", "modified_accepted", "escalated", "clarification_requested"].includes(
          review(position).status,
        ),
    );

    if (next >= 0)
      void navigate({
        to: "/ticket/$ticketId",
        params: { ticketId: data.proposals[next].ticket_id },
      });
  }

  return (
    <>
      <div className="backline">
        <Link to="/">← Back to queue</Link>
        <span>{ticketId} / 20</span>
      </div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TICKET REVIEW · {ticketId}</div>
          <h1>{ticket.Summary}</h1>
          <p>Review the original request against the proposed classification.</p>
        </div>
        {data.mock && <span className="mock-badge">MOCK DATA</span>}
      </div>
      <div className="review-grid">
        <section className="panel original-panel">
          <div className="panel-head">
            <div>
              <h2>Original ticket</h2>
              <p>Read only · incoming Jira record</p>
            </div>
          </div>
          <div className="original-fields">
            <OriginalField label="Request type" value={ticket["Request type"]} />
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
          <h3>Description</h3>
          <p className="description">{ticket.Description}</p>
          <h3>Comments</h3>
          <div className="comments">
            {ticket["All Comments"].length ? (
              ticket["All Comments"].map((comment, position) => {
                const [author, ...body] = comment.split(":");

                return (
                  <div key={position}>
                    <b>{author}</b>
                    <p>{body.join(":").trim()}</p>
                  </div>
                );
              })
            ) : (
              <p>No comments.</p>
            )}
          </div>
        </section>
        <section className="panel proposal-panel">
          <div className="panel-head">
            <div>
              <h2>Proposed resolution</h2>
              <p>Operator editable · {current.status.replaceAll("_", " ")}</p>
            </div>
            {data.mock && <span className="mock-mini">MOCK</span>}
          </div>
          <div className="form-grid">
            <label>
              Work type
              <select
                value={form.work_type}
                onChange={(event) => update({ work_type: event.target.value })}
              >
                <option>Incident</option>
                <option>Service Request</option>
              </select>
            </label>
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
            <div className="readonly-field">
              <span>Team · derived</span>
              <strong>{team}</strong>
            </div>
            <label>
              Assignee
              <select
                value={form.assignee}
                onChange={(event) => {
                  const content = form.resolution_comment.split(":").slice(1).join(":").trim();
                  update({
                    assignee: event.target.value,
                    resolution_comment: `${event.target.value}: ${content}`,
                  });
                }}
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
                    urgency: LEVELS.find((level) => level === event.target.value) ?? form.urgency,
                  })
                }
              >
                {LEVELS.map((level, position) => (
                  <option value={level} key={level}>
                    {level} — {URGENCY_LABELS[position]}
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
                {LEVELS.map((level, position) => (
                  <option value={level} key={level}>
                    {level} — {IMPACT_LABELS[position]}
                  </option>
                ))}
              </select>
            </label>
            <div className="readonly-field">
              <span>Priority · calculated</span>
              <strong>{computedPriority}</strong>
            </div>
            <label>
              Resolution
              <select
                value={form.resolution}
                onChange={(event) =>
                  update({
                    resolution:
                      RESOLUTIONS.find((value) => value === event.target.value) ?? form.resolution,
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
          <label className="textarea-label">
            Resolution comment
            <textarea
              rows={4}
              value={form.resolution_comment}
              onChange={(event) => update({ resolution_comment: event.target.value })}
            />
          </label>
          <div className="matrix">
            <span>Priority matrix · active cell outlined</span>
            <div className="matrix-grid">
              {PRIORITY_MATRIX.flatMap((row, urgencyIndex) =>
                row.map((level, impactIndex) => (
                  <div
                    key={`${urgencyIndex}-${impactIndex}`}
                    className={
                      form.urgency === LEVELS[urgencyIndex] && form.impact === LEVELS[impactIndex]
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
            <div className="warnings">
              <b>Review warnings</b>
              {warnings.map((warning) => (
                <p key={warning}>⚠ {warning}</p>
              ))}
            </div>
          )}
          <div className="action-row">
            <button
              className="button primary"
              disabled={changes.length > 0}
              onClick={() => finish("accept")}
            >
              Accept
            </button>
            <button
              className="button secondary"
              disabled={changes.length === 0}
              onClick={() => finish("modify")}
            >
              Modify & accept
            </button>
            <button
              className="button subtle"
              onClick={() => {
                const reason = window.prompt(
                  "Escalation reason: uncertain service, insufficient information, possible critical incident, or other",
                );

                if (reason?.trim()) finish("escalate", reason.trim());
              }}
            >
              Escalate
            </button>
            <button className="button subtle" onClick={() => finish("clarify")}>
              Ask clarification
            </button>
            <button
              className="button subtle"
              disabled={!current.previous}
              onClick={() => undo(index)}
            >
              Undo
            </button>
          </div>
          <button
            className="button subtle disabled-note"
            disabled
            title="File-only mode: no solver endpoint configured"
          >
            Regenerate with better model
          </button>
        </section>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>Model context {data.mock && <span className="mock-mini">MOCK</span>}</h2>
          <div className="confidence">
            <span>
              Work type{" "}
              <b>
                {Math.round(proposal.confidence.work_type * 100)}% ·{" "}
                {confidenceLabel(proposal.confidence.work_type)}
              </b>
            </span>
            <span>
              Service{" "}
              <b>
                {Math.round(proposal.confidence.service * 100)}% ·{" "}
                {confidenceLabel(proposal.confidence.service)}
              </b>
            </span>
          </div>
          <p>{proposal.rationale}</p>
          <h3>Proposal vs original</h3>
          <p className="diff">
            <b>Service</b> {ticket["Affected Business or IT Services"][0]} →{" "}
            {proposal.proposal.service}
          </p>
          <p className="diff">
            <b>Work type</b> {ticket["Work type"]} → {proposal.proposal.work_type}
          </p>
          <p className="diff">
            <b>Urgency / impact</b> {ticket.Urgency} / {ticket.Impact} → {proposal.proposal.urgency}{" "}
            / {proposal.proposal.impact}
          </p>
          <h3>Changes from model proposal</h3>
          {changes.length ? (
            changes.map((item) => (
              <p key={item.field} className="diff">
                <b>{item.field}</b> {item.before} → {item.after}
              </p>
            ))
          ) : (
            <p>No operator changes yet.</p>
          )}
        </section>
        <section className="panel">
          <h2>Similar historical tickets {data.mock && <span className="mock-mini">MOCK</span>}</h2>
          <p>Example matches by service; similarity has not been measured.</p>
          {proposal.similar_tickets.map((item) => (
            <button
              className="similar"
              key={item.historical_index}
              onClick={() => setSelected(data.historical_examples[String(item.historical_index)])}
            >
              <b>{item.summary}</b>
              <small>
                {item.service} · {item.resolution} · similarity not measured
              </small>
            </button>
          ))}
        </section>
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
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">
              ×
            </button>
            <h2>{selected.Summary}</h2>
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
            {selected["All Comments"].map((comment, position) => (
              <p key={position}>{comment}</p>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

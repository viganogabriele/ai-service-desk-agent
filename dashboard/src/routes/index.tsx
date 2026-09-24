import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDashboard } from "../state";
import { priority, serviceInfo, SERVICES } from "../domain";

export const Route = createFileRoute("/")({ component: Overview });

const statusLabels = {
  to_process: "To process",
  proposed: "Proposed",
  in_review: "In review",
  accepted: "Accepted",
  modified_accepted: "Modified",
  escalated: "Escalated",
  clarification_requested: "Clarification",
};

function Overview() {
  const { data, review } = useDashboard();
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [rating, setRating] = useState("all");
  const [change, setChange] = useState("all");

  const rows = data.challenge.map((ticket, index) => ({
    index,
    ticket,
    proposal: data.proposals[index],
    current: review(index),
  }));

  const accepted = rows.filter((row) =>
    ["accepted", "modified_accepted"].includes(row.current.status),
  ).length;

  const visible = rows
    .filter((row) => {
      if (status !== "all" && row.current.status !== status) return false;

      if (service !== "all" && row.current.form.service !== service) return false;

      if (rating !== "all" && serviceInfo(row.current.form.service)?.[2] !== rating) return false;

      if (
        change === "service" &&
        row.ticket["Affected Business or IT Services"][0] === row.current.form.service
      )
        return false;

      if (change === "work" && row.ticket["Work type"] === row.current.form.work_type) return false;

      return true;
    })
    .sort((a, b) => {
      const completed = ["accepted", "modified_accepted", "escalated", "clarification_requested"];

      return (
        Number(completed.includes(a.current.status)) -
          Number(completed.includes(b.current.status)) ||
        a.proposal.confidence.service - b.proposal.confidence.service
      );
    });

  const h = data.historical;
  const done = h.status.done ?? 0;
  const fmt = (value: number) => value.toLocaleString("en-US");

  return (
    <>
      <div className="eyebrow">OPERATIONS / TRIAGE DESK</div>
      <div className="page-heading">
        <div>
          <h1>Ticket triage overview</h1>
          <p>Historical signals and the incoming challenge queue.</p>
        </div>
        <span className="date-chip">Swiss AI Weeks · 2026</span>
      </div>
      <section className="kpi-grid" aria-label="Historical KPIs">
        <div className="kpi">
          <span>Historical tickets</span>
          <strong>{fmt(h.total)}</strong>
          <small>Source: historical ticket file</small>
        </div>
        <div className="kpi">
          <span>Done status</span>
          <strong>{fmt(done)}</strong>
          <small>
            {fmt(h.status["in progress"] ?? 0)} in progress · {fmt(h.status.open ?? 0)} open
          </small>
        </div>
        <div className="kpi">
          <span>Generic service bucket</span>
          <strong>{fmt(h.generic_bucket)}</strong>
          <small>{((h.generic_bucket / h.total) * 100).toFixed(1)}% of historical tickets</small>
        </div>
        <div className="kpi accent">
          <span>Incoming challenge</span>
          <strong>{fmt(data.challenge.length)}</strong>
          <small>
            {fmt(data.challenge.filter((ticket) => ticket["Work type"] === "Incident").length)}{" "}
            incidents ·{" "}
            {fmt(
              data.challenge.filter((ticket) => ticket["Work type"] === "Service Request").length,
            )}{" "}
            requests
          </small>
        </div>
      </section>
      <div className="split-panels">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Done status by resolution</h2>
              <p>“Done” includes outcomes other than resolved.</p>
            </div>
            <b>{fmt(done)}</b>
          </div>
          <div className="stacked-bar">
            {Object.entries(h.resolution).map(([key, count], index) => (
              <span
                key={key}
                className={`segment segment-${index}`}
                style={{ width: `${(count / done) * 100}%` }}
                title={`${key}: ${count}`}
              />
            ))}
          </div>
          <div className="legend">
            {Object.entries(h.resolution).map(([key, count], index) => (
              <span key={key}>
                <i className={`legend-dot segment-${index}`} />
                {key} <b>{fmt(count)}</b>
              </span>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Work type</h2>
              <p>Historical count from source data.</p>
            </div>
          </div>
          <div className="work-bars">
            {Object.entries(h.work_type).map(([key, count]) => (
              <div key={key}>
                <div className="bar-label">
                  <span>{key}</span>
                  <b>{fmt(count)}</b>
                </div>
                <div className="track">
                  <span style={{ width: `${(count / h.total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel queue-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">CHALLENGE REVIEW</div>
            <h2>Incoming queue</h2>
            <p>
              {accepted} of {data.challenge.length} accepted · {visible.length} shown
            </p>
          </div>
          <div className="progress-ring">
            {Math.round((accepted / data.challenge.length) * 100)}%
          </div>
        </div>
        <div className="queue-progress">
          <span style={{ width: `${(accepted / data.challenge.length) * 100}%` }} />
        </div>
        <div className="status-chips">
          {Object.entries(statusLabels).map(([key, label]) => (
            <span key={key}>
              {label} <b>{rows.filter((row) => row.current.status === key).length}</b>
            </span>
          ))}
        </div>
        <div className="filters">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Proposed service
            <select value={service} onChange={(event) => setService(event.target.value)}>
              <option value="all">All services</option>
              {SERVICES.map(([name]) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rating
            <select value={rating} onChange={(event) => setRating(event.target.value)}>
              <option value="all">All ratings</option>
              <option>Critical</option>
              <option>Non-Critical</option>
            </select>
          </label>
          <label>
            Changes
            <select value={change} onChange={(event) => setChange(event.target.value)}>
              <option value="all">All tickets</option>
              <option value="service">Service changed</option>
              <option value="work">Work type changed</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Summary / request type</th>
                <th>Service</th>
                <th>Work type</th>
                <th>Priority</th>
                <th>Confidence</th>
                <th>Review</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ ticket, proposal, current }) => (
                <tr key={proposal.ticket_id}>
                  <td className="ticket-id">{proposal.ticket_id}</td>
                  <td>
                    <Link
                      to="/ticket/$ticketId"
                      params={{ ticketId: proposal.ticket_id }}
                      className="summary-link"
                    >
                      {ticket.Summary}
                    </Link>
                    <small>{ticket["Request type"]}</small>
                  </td>
                  <td>
                    {ticket["Affected Business or IT Services"][0] !== current.form.service && (
                      <span className="old-value">
                        {ticket["Affected Business or IT Services"][0]} →{" "}
                      </span>
                    )}
                    {current.form.service}
                  </td>
                  <td>
                    {ticket["Work type"] !== current.form.work_type && (
                      <span className="old-value">{ticket["Work type"]} → </span>
                    )}
                    {current.form.work_type}
                  </td>
                  <td>
                    <span className="priority-pill">
                      {priority(current.form.urgency, current.form.impact)}
                    </span>
                  </td>
                  <td>
                    {Math.round(proposal.confidence.service * 100)}%{" "}
                    {data.mock && <span className="mock-mini">MOCK</span>}
                  </td>
                  <td>
                    <span className={`status status-${current.status}`}>
                      {statusLabels[current.status]}
                    </span>
                  </td>
                  <td>
                    <Link
                      to="/ticket/$ticketId"
                      params={{ ticketId: proposal.ticket_id }}
                      aria-label={`Review ${proposal.ticket_id}`}
                    >
                      ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="empty">No tickets match these filters.</div>}
        </div>
      </section>
    </>
  );
}

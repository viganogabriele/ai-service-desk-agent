import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight, Check, Columns3, Rows3, TriangleAlert, X } from "lucide-react";
import { useDashboard } from "../state";
import {
  ESCALATION_REASONS,
  STATUS_LABELS,
  formChanges,
  reviewWarnings,
  startingForm,
} from "../domain";
import type { ReviewStatus } from "../domain";
import {
  Confidence,
  FilterSelects,
  PriorityPill,
  SearchField,
  StatusPill,
  StatusSelect,
  isOpen,
  useTicketFilters,
  useTicketRows,
} from "../components/tickets";
import type { TicketRow } from "../components/tickets";

export const Route = createFileRoute("/tickets/")({ component: TicketList });

const BOARD: { title: string; statuses: ReviewStatus[] }[] = [
  { title: "To process", statuses: ["to_process", "proposed"] },
  { title: "In review", statuses: ["in_review"] },
  { title: "Resolved", statuses: ["accepted", "modified_accepted"] },
  { title: "Escalated", statuses: ["escalated"] },
  { title: "Clarification", statuses: ["clarification_requested"] },
];

function TicketList() {
  const { data, act } = useDashboard();
  const { filters, setFilters } = useTicketFilters();
  const { rows, visible } = useTicketRows();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>(ESCALATION_REASONS[0]);

  const resolved = rows.filter((row) =>
    ["accepted", "modified_accepted"].includes(row.current.status),
  ).length;

  const open = rows.filter((row) => isOpen(row.current.status)).length;
  const visibleIds = visible.map((row) => row.proposal.ticket_id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const chosen = rows.filter((row) => selected.has(row.proposal.ticket_id));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const bulk = (action: "resolve" | "escalate" | "clarify") => {
    for (const row of chosen) {
      if (action === "resolve")
        act(
          row.index,
          formChanges(row.current.form, startingForm(row.proposal)).length ? "modify" : "accept",
        );
      else if (action === "escalate") act(row.index, "escalate", { reason });
      else act(row.index, "clarify");
    }

    setSelected(new Set());
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="utility">Operations · Ticket workspace</span>
          <h1>Tickets</h1>
          <p className="num">
            {open} open · {resolved} of {rows.length} resolved · {visible.length} shown
          </p>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button
            aria-pressed={filters.view === "table"}
            onClick={() => setFilters({ view: "table" })}
          >
            <Rows3 size={14} strokeWidth={1.75} />
            Table
          </button>
          <button
            aria-pressed={filters.view === "board"}
            onClick={() => setFilters({ view: "board" })}
          >
            <Columns3 size={14} strokeWidth={1.75} />
            Board
          </button>
        </div>
      </div>
      <div className="toolbar">
        <SearchField />
        <div className="filters">
          <StatusSelect />
          <FilterSelects />
        </div>
      </div>
      {chosen.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <b className="num">{chosen.length} selected</b>
          <button className="button primary" onClick={() => bulk("resolve")}>
            <Check size={16} strokeWidth={1.75} />
            Resolve with proposal
          </button>
          <span className="bulk-group">
            <label>
              <span className="sr-only">Escalation reason</span>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                {ESCALATION_REASONS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <button className="button" onClick={() => bulk("escalate")}>
              Escalate
            </button>
          </span>
          <button className="button" onClick={() => bulk("clarify")}>
            Ask clarification
          </button>
          <button className="button ghost push" onClick={() => setSelected(new Set())}>
            <X size={16} strokeWidth={1.75} />
            Clear
          </button>
        </div>
      )}
      {filters.view === "table" ? (
        <section className="card queue-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="check">
                    <input
                      type="checkbox"
                      aria-label="Select all shown tickets"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set([...selected, ...visibleIds]))
                      }
                    />
                  </th>
                  <th>Ticket</th>
                  <th>Summary / request type</th>
                  <th>Service</th>
                  <th>Work type</th>
                  <th>Priority</th>
                  <th className="right">Confidence</th>
                  <th>Review</th>
                  <th className="right">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <TableRow
                    key={row.proposal.ticket_id}
                    row={row}
                    selected={selected.has(row.proposal.ticket_id)}
                    onToggle={() => toggle(row.proposal.ticket_id)}
                  />
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <div className="empty">No tickets match these filters.</div>}
          </div>
        </section>
      ) : (
        <div className="board">
          {BOARD.map((column) => {
            const cards = visible.filter((row) => column.statuses.includes(row.current.status));

            return (
              <section className="board-column" key={column.title} aria-label={column.title}>
                <header>
                  {column.title}
                  <span className="num">{cards.length}</span>
                </header>
                {cards.map((row) => (
                  <BoardCard key={row.proposal.ticket_id} row={row} />
                ))}
                {cards.length === 0 && <p className="board-empty">Nothing here</p>}
              </section>
            );
          })}
        </div>
      )}
      {data.mock && (
        <p className="card-note page-note">
          Proposals are mock fixtures mirroring the declared fields; confidence is not measured.
        </p>
      )}
    </>
  );
}

function TableRow({
  row,
  selected,
  onToggle,
}: {
  row: TicketRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const { ticket, proposal, current } = row;
  const warnings = reviewWarnings(ticket, current.form).length;

  const open = () =>
    void navigate({ to: "/tickets/$ticketId", params: { ticketId: proposal.ticket_id } });

  return (
    <tr className={selected ? "selected clickable" : "clickable"} onClick={open}>
      <td className="check" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${proposal.ticket_id}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className="ticket-id">{proposal.ticket_id}</td>
      <td>
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: proposal.ticket_id }}
          className="summary-link"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.Summary}
        </Link>
        <small>
          {ticket["Request type"]}
          {warnings > 0 && (
            <span className="warn-inline" title={`${warnings} review warning(s)`}>
              <TriangleAlert size={12} strokeWidth={1.75} />
              {warnings}
            </span>
          )}
        </small>
      </td>
      <td className="wrap">
        {ticket["Affected Business or IT Services"][0] !== current.form.service && (
          <>
            <span className="old-value">{ticket["Affected Business or IT Services"][0]}</span>
            <span className="change-arrow">→</span>
          </>
        )}
        <span className="value">{current.form.service}</span>
      </td>
      <td>
        {ticket["Work type"] !== current.form.work_type && (
          <>
            <span className="old-value">{ticket["Work type"]}</span>
            <span className="change-arrow">→</span>
          </>
        )}
        <span className="value">{current.form.work_type}</span>
      </td>
      <td>
        <PriorityPill row={row} />
      </td>
      <td className="right">
        <Confidence value={proposal.confidence.service} />
      </td>
      <td>
        <StatusPill status={current.status} />
      </td>
      <td className="right">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: proposal.ticket_id }}
          aria-label={`Open ${proposal.ticket_id}`}
          className="icon-button"
          onClick={(event) => event.stopPropagation()}
        >
          <ArrowUpRight size={16} strokeWidth={1.75} />
        </Link>
      </td>
    </tr>
  );
}

function BoardCard({ row }: { row: TicketRow }) {
  const { ticket, proposal, current } = row;
  const warnings = reviewWarnings(ticket, current.form).length;

  return (
    <Link to="/tickets/$ticketId" params={{ ticketId: proposal.ticket_id }} className="board-card">
      <span className="board-card-head">
        <span className="ticket-id">{proposal.ticket_id}</span>
        <PriorityPill row={row} />
      </span>
      <b>{ticket.Summary}</b>
      <small>
        {current.form.service} · {current.form.work_type}
      </small>
      <span className="board-card-foot">
        <span className="muted">{STATUS_LABELS[current.status]}</span>
        {warnings > 0 && (
          <span className="warn-inline">
            <TriangleAlert size={12} strokeWidth={1.75} />
            {warnings}
          </span>
        )}
      </span>
    </Link>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { serviceInfo } from "../domain";
import { Initials, PriorityBadge, StatusPill, isOpen, personName } from "./tickets";
import type { TicketRow } from "./tickets";

export interface Selection {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

/** Queue table. Rows arrive already ordered; pass `selection` to add checkboxes for bulk actions. */
export function TicketTable({ rows, selection }: { rows: TicketRow[]; selection?: Selection }) {
  const ids = rows.map((row) => row.id);
  const allSelected = ids.length > 0 && ids.every((id) => selection?.selected.has(id));
  const someSelected = ids.some((id) => selection?.selected.has(id));

  return (
    <section className="card queue-card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {selection && (
                <th className="check">
                  <label className="check-hit">
                    <input
                      type="checkbox"
                      aria-label="Select all shown tickets"
                      checked={allSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = someSelected && !allSelected;
                      }}
                      onChange={selection.onToggleAll}
                    />
                  </label>
                </th>
              )}
              <th>Ticket</th>
              <th data-tip="Calculated from urgency and impact">Priority</th>
              <th>Service</th>
              <th>Assignee</th>
              <th>Status</th>
              <th className="row-action" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TableRow key={row.id} row={row} selection={selection} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No tickets match these filters.</div>}
      </div>
    </section>
  );
}

function TableRow({ row, selection }: { row: TicketRow; selection?: Selection }) {
  const navigate = useNavigate();
  const { ticket, proposal, current, id } = row;
  const declared = ticket["Affected Business or IT Services"][0];
  const selected = selection?.selected.has(id) ?? false;
  const open = () => void navigate({ to: "/tickets/$ticketId", params: { ticketId: id } });

  return (
    <tr className={selected ? "selected clickable" : "clickable"} onClick={open}>
      {selection && (
        <td className="check" onClick={(event) => event.stopPropagation()}>
          <label className="check-hit">
            <input
              type="checkbox"
              aria-label={`Select ${id}`}
              checked={selected}
              disabled={!isOpen(current.status)}
              onChange={() => selection.onToggle(id)}
            />
          </label>
        </td>
      )}
      <td className="wrap summary-cell">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: id }}
          className="summary-link"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.Summary}
        </Link>
        <small>
          <span className="ticket-id">{id}</span> · {ticket["Request type"]} ·{" "}
          {personName(ticket.Reporter)}
        </small>
      </td>
      <td className="priority-cell">
        <PriorityBadge triage={current.triage} />
      </td>
      <td className="wrap service-cell">
        <span className="value">{current.triage.service}</span>
        <small>
          {proposal && proposal.proposal.service !== declared ? (
            <span className="ai-note">
              <Sparkles size={11} strokeWidth={2} />
              AI changed from {declared}
            </span>
          ) : (
            serviceInfo(current.triage.service)?.[1]
          )}
        </small>
      </td>
      <td className="assignee-cell">
        {current.triage.assignee ? (
          <span className="person">
            <Initials email={current.triage.assignee} />
            <span>{personName(current.triage.assignee)}</span>
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
      </td>
      <td className="status-cell">
        <StatusPill status={current.status} />
      </td>
      <td className="row-action">
        <span className="icon-button" aria-hidden="true">
          <ArrowRight size={16} strokeWidth={1.75} />
        </span>
      </td>
    </tr>
  );
}

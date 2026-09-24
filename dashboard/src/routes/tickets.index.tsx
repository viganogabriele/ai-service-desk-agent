import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Columns3, Rows3, Sparkles, UserPlus, X } from "lucide-react";
import { useDashboard } from "../state";
import type { Editable } from "../state";
import { STATUSES, STATUS_DOTS, STATUS_HELP, STATUS_LABELS, serviceInfo } from "../domain";
import type { Status } from "../domain";
import {
  FilterSelects,
  Initials,
  PriorityPill,
  SearchField,
  StatusFilter,
  StatusPill,
  isOpen,
  personName,
  useTicketFilters,
  useTicketRows,
} from "../components/tickets";
import type { TicketRow } from "../components/tickets";
import { CommentEditor, Dialog, Menu, OutcomePicker } from "../components/ui";

export const Route = createFileRoute("/tickets/")({ component: TicketList });

interface PendingMove {
  row: TicketRow;
  target: "resolved" | "waiting";
}

function TicketList() {
  const { assign, move, exportData, reset } = useDashboard();
  const { filters, setFilters } = useTicketFilters();
  const { rows, visible } = useTicketRows();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const open = rows.filter((row) => isOpen(row.current.status)).length;
  const visibleIds = visible.map((row) => row.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));
  const chosen = rows.filter((row) => selected.has(row.id) && isOpen(row.current.status));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const moveTo = (row: TicketRow, target: Status) => {
    if (target === row.current.status) return;

    if (target === "resolved" || target === "waiting") setPending({ row, target });
    else if (target === "assigned") assign(row.index);
    else move(row.index, target);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Tickets</h1>
          <p className="num">
            {open} open of {rows.length} incoming tickets
          </p>
        </div>
        <div className="heading-actions">
          <div className="segmented" role="group" aria-label="View">
            <button
              aria-pressed={filters.view === "table"}
              onClick={() => setFilters({ view: "table" })}
            >
              <Rows3 size={14} strokeWidth={1.75} />
              List
            </button>
            <button
              aria-pressed={filters.view === "board"}
              onClick={() => {
                setFilters({ view: "board", status: "all" });
              }}
            >
              <Columns3 size={14} strokeWidth={1.75} />
              Board
            </button>
          </div>
          <Menu
            label="More actions"
            items={[
              { label: "Export triaged tickets (JSON)", onSelect: exportData },
              {
                label: "Clear all review data",
                danger: true,
                onSelect: () => setConfirmReset(true),
              },
            ]}
          />
        </div>
      </div>
      <div className="toolbar">
        <SearchField />
        <div className="filters">
          {filters.view === "table" && <StatusFilter />}
          <FilterSelects />
        </div>
      </div>
      {chosen.length > 0 && filters.view === "table" && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <b className="num">{chosen.length} selected</b>
          <button
            className="button primary"
            onClick={() => {
              for (const row of chosen) assign(row.index);
              setSelected(new Set());
            }}
          >
            <UserPlus size={16} strokeWidth={1.75} />
            Assign to service teams
          </button>
          <span className="muted bulk-hint">
            Each ticket goes to the team of its current service.
          </span>
          <button
            className="button ghost push"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X size={16} strokeWidth={1.75} />
            <span className="bulk-clear-label">Clear selection</span>
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
                    <label className="check-hit">
                      <input
                        type="checkbox"
                        aria-label="Select all shown tickets"
                        checked={allSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={() =>
                          setSelected(
                            allSelected ? new Set() : new Set([...selected, ...visibleIds]),
                          )
                        }
                      />
                    </label>
                  </th>
                  <th>Ticket</th>
                  <th>Service</th>
                  <th data-tip="Calculated from urgency and impact">Priority</th>
                  <th>Assignee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <TableRow
                    key={row.id}
                    row={row}
                    selected={selected.has(row.id)}
                    onToggle={() => toggle(row.id)}
                  />
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <div className="empty">No tickets match these filters.</div>}
          </div>
        </section>
      ) : (
        <Board rows={visible} onMove={moveTo} />
      )}
      {pending && <MoveDialog pending={pending} onClose={() => setPending(null)} />}
      {confirmReset && (
        <Dialog
          title="Clear all review data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button className="button ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() => {
                  reset();
                  setConfirmReset(false);
                }}
              >
                Clear review data
              </button>
            </>
          }
        >
          <p className="dialog-text">
            Every triage decision, comment and status change stored in this browser will be removed.
            Export the triaged tickets first if you want to keep them.
          </p>
        </Dialog>
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
  const { ticket, proposal, current, id } = row;
  const declared = ticket["Affected Business or IT Services"][0];
  const open = () => void navigate({ to: "/tickets/$ticketId", params: { ticketId: id } });

  return (
    <tr className={selected ? "selected clickable" : "clickable"} onClick={open}>
      <td className="check" onClick={(event) => event.stopPropagation()}>
        <label className="check-hit">
          <input
            type="checkbox"
            aria-label={`Select ${id}`}
            checked={selected}
            disabled={!isOpen(current.status)}
            onChange={onToggle}
          />
        </label>
      </td>
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
      <td className="wrap service-cell">
        <span className="value">{current.triage.service}</span>
        <small>
          {proposal && proposal.proposal.service !== declared ? (
            <span className="ai-note">
              <Sparkles size={11} strokeWidth={1.75} />
              AI changed from {declared}
            </span>
          ) : (
            serviceInfo(current.triage.service)?.[1]
          )}
        </small>
      </td>
      <td className="priority-cell">
        <PriorityPill triage={current.triage} detail />
      </td>
      <td className="assignee-cell">
        {current.triage.assignee ? (
          <span className="person">
            <Initials email={current.triage.assignee} />
            {personName(current.triage.assignee)}
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
      </td>
      <td className="status-cell">
        <StatusPill status={current.status} />
      </td>
    </tr>
  );
}

function Board({
  rows,
  onMove,
}: {
  rows: TicketRow[];
  onMove: (row: TicketRow, target: Status) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  return (
    <div className="board">
      {STATUSES.map((status) => {
        const cards = rows.filter((row) => row.current.status === status);

        return (
          <section
            key={status}
            className={over === status ? "board-column drop" : "board-column"}
            aria-label={STATUS_LABELS[status]}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver(status);
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget instanceof Node ? event.relatedTarget : null,
                )
              )
                setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const row = rows.find((item) => item.id === event.dataTransfer.getData("text/plain"));
              setOver(null);
              setDragging(null);

              if (row) onMove(row, status);
            }}
          >
            <header data-tip={STATUS_HELP[status]}>
              <span>
                <i className={`dot ${STATUS_DOTS[status]}`} />
                {STATUS_LABELS[status]}
              </span>
              <span className="num">{cards.length}</span>
            </header>
            {cards.map((row) => (
              <BoardCard
                key={row.id}
                row={row}
                dragging={dragging === row.id}
                onDragStart={() => setDragging(row.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              />
            ))}
            {cards.length === 0 && <p className="board-empty">Drop a ticket here</p>}
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  row,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  row: TicketRow;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { ticket, current, id } = row;

  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: id }}
      className={dragging ? "board-card dragging" : "board-card"}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <span className="board-card-head">
        <span className="ticket-id">{id}</span>
        <PriorityPill triage={current.triage} />
      </span>
      <b>{ticket.Summary}</b>
      <span className="board-card-service">{current.triage.service}</span>
      <span className="board-card-foot">
        {current.triage.assignee ? (
          <span className="person">
            <Initials email={current.triage.assignee} />
            {personName(current.triage.assignee)}
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
      </span>
    </Link>
  );
}

/** Resolving or asking the reporter needs a written comment, so board drops confirm through this dialog. */
function MoveDialog({ pending, onClose }: { pending: PendingMove; onClose: () => void }) {
  const { resolve, askReporter } = useDashboard();
  const { row, target } = pending;
  const [reply, setReply] = useState(row.current.reply);
  const [question, setQuestion] = useState(row.current.question);
  const [outcome, setOutcome] = useState(row.current.outcome);
  const assignee = row.current.triage.assignee;
  const text = target === "resolved" ? reply : question;

  const confirm = () => {
    const changes: Editable = target === "resolved" ? { reply, outcome } : { question };

    if (target === "resolved") resolve(row.index, changes);
    else askReporter(row.index, changes);
    onClose();
  };

  return (
    <Dialog
      title={
        target === "resolved"
          ? `Resolve ${row.id}`
          : `Ask ${personName(row.ticket.Reporter)} for information`
      }
      description={row.ticket.Summary}
      onClose={onClose}
      footer={
        <>
          {!assignee && <span className="muted">Assign the ticket before posting a comment.</span>}
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!assignee || !text.trim()} onClick={confirm}>
            {target === "resolved" ? "Resolve ticket" : "Send question"}
          </button>
        </>
      }
    >
      {target === "resolved" ? (
        <>
          <OutcomePicker value={outcome} onChange={setOutcome} />
          <CommentEditor
            author={assignee}
            label="Resolution note for the reporter"
            placeholder="What was done, and how the reporter can confirm it is fixed."
            value={reply}
            onChange={setReply}
          />
        </>
      ) : (
        <CommentEditor
          author={assignee}
          label="Question for the reporter"
          placeholder="What information do you need to continue?"
          rows={4}
          value={question}
          onChange={setQuestion}
        />
      )}
    </Dialog>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { useDashboard } from "../state";
import type { Editable } from "../state";
import { STATUSES, STATUS_DOTS, STATUS_HELP, STATUS_LABELS } from "../domain";
import type { Status } from "../domain";
import {
  FilterSelects,
  Initials,
  PriorityBadge,
  SearchField,
  StatusFilter,
  isOpen,
  personName,
  useTicketFilters,
  useTicketRows,
} from "../components/tickets";
import type { TicketRow } from "../components/tickets";
import { PriorityView } from "../components/priority";
import { TicketTable } from "../components/table";
import { CommentEditor, Dialog, Menu, OutcomePicker } from "../components/ui";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { SectionCount, SectionHead, SectionText, SectionTitle } from "../components/ui/section";
import { cn } from "../lib/utils";

const VIEWS = ["priority", "table", "board"] as const;

export const Route = createFileRoute("/tickets/")({
  component: TicketList,
  // `?view=` makes a view linkable; the filters context keeps it once the page is open.
  validateSearch: (search: { view?: string }): { view?: (typeof VIEWS)[number] } => {
    const view = VIEWS.find((item) => item === search.view);

    return view ? { view } : {};
  },
});

interface PendingMove {
  row: TicketRow;
  target: "resolved" | "waiting";
}

function TicketList() {
  const { assign, move, exportData, reset } = useDashboard();
  const { filters, setFilters } = useTicketFilters();
  const { view } = Route.useSearch();
  const { rows, visible } = useTicketRows();

  useEffect(() => {
    if (view && view !== filters.view) setFilters({ view });
  }, [view, filters.view, setFilters]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const open = rows.filter((row) => isOpen(row.current.status)).length;
  const visibleIds = visible.map((row) => row.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
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
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <SearchField className="max-sm:w-full" />
        <div className="flex flex-wrap gap-2 max-sm:w-full">
          {filters.view === "table" && <StatusFilter />}
          <FilterSelects />
        </div>
        <span className="ml-auto" />
        <Menu
          // Matches the search field and filters beside it.
          className="size-10 bg-surface"
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
      {chosen.length > 0 && filters.view === "table" && (
        <div
          data-bulk-bar
          className="sticky top-21 z-3 mb-3.5 flex animate-rise-in flex-wrap items-center gap-2 rounded-card border border-border-hover bg-elevated py-2 pr-2 pl-4.5 shadow-float max-md:fixed max-md:top-auto max-md:right-safe-r max-md:bottom-safe-b max-md:left-safe-l max-md:z-20 max-md:m-0"
          role="region"
          aria-label="Bulk actions"
        >
          <b className="mr-2 font-semibold tabular-nums">{chosen.length} selected</b>
          <Button
            variant="primary"
            onClick={() => {
              for (const row of chosen) assign(row.index);
              setSelected(new Set());
            }}
          >
            <UserPlus size={16} strokeWidth={1.75} />
            Assign to service teams
          </Button>
          <span className="text-muted max-md:hidden">
            Each ticket goes to the team of its current service.
          </span>
          <Button
            variant="ghost"
            className="ml-auto"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X size={16} strokeWidth={1.75} />
          </Button>
        </div>
      )}
      {filters.view === "table" ? (
        <>
          <SectionHead>
            <SectionTitle>
              All tickets
              <SectionCount>{visible.length}</SectionCount>
            </SectionTitle>
            <SectionText className="tabular-nums">{open} open</SectionText>
          </SectionHead>
          <TicketTable
            rows={visible}
            selection={{
              selected,
              onToggle: toggle,
              onToggleAll: () =>
                setSelected(allSelected ? new Set() : new Set([...selected, ...visibleIds])),
            }}
          />
        </>
      ) : filters.view === "board" ? (
        <>
          <SectionHead>
            <SectionTitle>
              Kanban
              <SectionCount>{visible.length}</SectionCount>
            </SectionTitle>
            <SectionText>Drag a ticket between columns to change its status</SectionText>
          </SectionHead>
          <Board rows={visible} onMove={moveTo} />
        </>
      ) : (
        <PriorityView rows={visible} />
      )}
      {pending && <MoveDialog pending={pending} onClose={() => setPending(null)} />}
      {confirmReset && (
        <Dialog
          title="Clear all review data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  reset();
                  setConfirmReset(false);
                }}
              >
                Clear review data
              </Button>
            </>
          }
        >
          <p className="leading-relaxed text-secondary">
            Every triage decision, comment and status change stored in this browser will be removed.
            Export the triaged tickets first if you want to keep them.
          </p>
        </Dialog>
      )}
    </>
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
    <div className="grid grid-cols-board gap-card-gap overflow-x-auto pb-2 max-md:-mx-page max-md:scroll-px-page max-md:snap-x max-md:snap-mandatory max-md:grid-cols-board-swipe max-md:px-page">
      {STATUSES.map((status) => {
        const cards = rows.filter((row) => row.current.status === status);

        return (
          <section
            key={status}
            // Columns scroll on their own, so a long column does not push the board off the page.
            className={cn(
              "grid max-h-column min-h-70 content-start gap-2.5 overflow-y-auto overscroll-y-contain rounded-card border bg-shell px-3 pb-3 transition-colors duration-120 max-md:snap-start",
              over === status && "border-dashed border-ring bg-drop",
            )}
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
            <header
              className="sticky top-0 z-1 -mx-3 flex items-center justify-between bg-inherit px-4.5 pt-4 pb-2 font-display text-base font-semibold"
              data-tip={STATUS_HELP[status]}
            >
              <span className="inline-flex items-center gap-2 text-foreground">
                <Dot tone={STATUS_DOTS[status]} />
                {STATUS_LABELS[status]}
              </span>
              <span className="inline-grid h-5 min-w-6 place-items-center rounded-pill bg-active px-1.75 font-sans text-sm font-semibold text-secondary tabular-nums">
                {cards.length}
              </span>
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
            {cards.length === 0 && (
              <p className="px-1 py-5 text-center text-sm text-muted">Drop a ticket here</p>
            )}
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
      className={cn(
        "group/card grid cursor-grab gap-2.5 rounded-tile border bg-surface p-3.5 transition duration-200 ease-soft hover:-translate-y-px hover:border-border-hover hover:shadow-float active:cursor-grabbing",
        dragging &&
          "scale-98 border-dashed opacity-45 shadow-none hover:translate-y-0 hover:shadow-none",
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <span className="flex items-center justify-between gap-2 text-sm">
        <PriorityBadge triage={current.triage} />
        <span className="text-sm font-medium whitespace-nowrap text-muted tabular-nums">{id}</span>
      </span>
      <b className="line-clamp-2 font-display text-base leading-snug font-medium text-foreground transition-colors duration-150 ease-soft group-hover/card:text-primary-text">
        {ticket.Summary}
      </b>
      <span className="text-sm text-secondary">{current.triage.service}</span>
      <span className="flex items-center justify-between gap-2 border-t border-divider pt-2.5 text-sm">
        {current.triage.assignee ? (
          <span className="inline-flex min-w-0 items-center gap-2 text-secondary">
            <Initials email={current.triage.assignee} />
            <span className="truncate">{personName(current.triage.assignee)}</span>
          </span>
        ) : (
          <span className="text-muted">Unassigned</span>
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
          {!assignee && (
            <span className="mr-auto text-sm text-muted max-sm:basis-full">
              Assign the ticket before posting a comment.
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!assignee || !text.trim()} onClick={confirm}>
            {target === "resolved" ? "Resolve ticket" : "Send question"}
          </Button>
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

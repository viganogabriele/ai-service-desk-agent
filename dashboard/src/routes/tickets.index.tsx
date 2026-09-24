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
  BoardEmpty,
  PriorityPill,
  SearchField,
  StatusPill,
  StatusSelect,
  isOpen,
  useTicketFilters,
  useTicketRows,
} from "../components/tickets";
import type { TicketRow } from "../components/tickets";
import { buttonVariants, Button } from "../components/ui/button";
import { Card, CardDescription } from "../components/ui/card";
import { ChangeArrow, OldValue } from "../components/ui/change";
import { Checkbox, Field, Select } from "../components/ui/field";
import { Eyebrow, PageDescription, PageHeader, PageTitle } from "../components/ui/page";
import { Segmented, SegmentedItem } from "../components/ui/segmented";
import { CellNote, Table, TableCell, TableHead, TableScroll } from "../components/ui/table";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/tickets/")({ component: TicketList });

const filterSelect = "w-auto min-w-35";

const checkCell = "w-9 pr-0";

const ticketIdText = "text-sm font-medium text-muted tabular-nums";

const ticketId = cn(ticketIdText, "whitespace-nowrap");

const boardCardRow = "flex items-center justify-between gap-2 text-sm";

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
      <PageHeader>
        <div>
          <Eyebrow>Operations · Ticket workspace</Eyebrow>
          <PageTitle>Tickets</PageTitle>
          <PageDescription className="tabular-nums">
            {open} open · {resolved} of {rows.length} resolved · {visible.length} shown
          </PageDescription>
        </div>
        <Segmented aria-label="View">
          <SegmentedItem
            aria-pressed={filters.view === "table"}
            onClick={() => setFilters({ view: "table" })}
          >
            <Rows3 size={14} strokeWidth={1.75} />
            Table
          </SegmentedItem>
          <SegmentedItem
            aria-pressed={filters.view === "board"}
            onClick={() => setFilters({ view: "board" })}
          >
            <Columns3 size={14} strokeWidth={1.75} />
            Board
          </SegmentedItem>
        </Segmented>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchField />
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <StatusSelect className={filterSelect} />
          <FilterSelects className={filterSelect} />
        </div>
      </div>
      {chosen.length > 0 && (
        <div
          className="sticky top-2 z-3 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-ring bg-elevated py-2 pr-2 pl-4 shadow-float"
          role="region"
          aria-label="Bulk actions"
        >
          <b className="mr-2 font-semibold tabular-nums">{chosen.length} selected</b>
          <Button variant="primary" onClick={() => bulk("resolve")}>
            <Check size={16} strokeWidth={1.75} />
            Resolve with proposal
          </Button>
          <span className="inline-flex gap-1">
            <Field>
              <span className="sr-only">Escalation reason</span>
              <Select
                className="h-8.5"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {ESCALATION_REASONS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Button onClick={() => bulk("escalate")}>Escalate</Button>
          </span>
          <Button onClick={() => bulk("clarify")}>Ask clarification</Button>
          <Button variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X size={16} strokeWidth={1.75} />
            Clear
          </Button>
        </div>
      )}
      {filters.view === "table" ? (
        <Card className="pb-0 sm:pb-0">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <TableHead className={checkCell}>
                    <Checkbox
                      aria-label="Select all shown tickets"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set([...selected, ...visibleIds]))
                      }
                    />
                  </TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Summary / request type</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Work type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Open</span>
                  </TableHead>
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
            </Table>
            {visible.length === 0 && (
              <div className="border-t border-divider px-5 py-10 text-center text-muted">
                No tickets match these filters.
              </div>
            )}
          </TableScroll>
        </Card>
      ) : (
        <div className="grid grid-cols-board gap-3 overflow-x-auto pb-2">
          {BOARD.map((column) => {
            const cards = visible.filter((row) => column.statuses.includes(row.current.status));

            return (
              <section
                className="grid min-h-60 content-start gap-2 rounded-card border bg-surface p-2.5"
                key={column.title}
                aria-label={column.title}
              >
                <header className="flex justify-between px-1 pt-0.5 pb-1.5 text-sm font-semibold text-secondary">
                  {column.title}
                  <span className="font-medium text-muted tabular-nums">{cards.length}</span>
                </header>
                {cards.map((row) => (
                  <BoardCard key={row.proposal.ticket_id} row={row} />
                ))}
                {cards.length === 0 && <BoardEmpty>Nothing here</BoardEmpty>}
              </section>
            );
          })}
        </div>
      )}
      {data.mock && (
        <CardDescription className="mt-3">
          Proposals are mock fixtures mirroring the declared fields; confidence is not measured.
        </CardDescription>
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
    <tr
      className={cn("cursor-pointer", selected ? "bg-primary-subtle" : "hover:bg-white/2")}
      onClick={open}
    >
      <TableCell className={checkCell} onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={`Select ${proposal.ticket_id}`}
          checked={selected}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className={ticketId}>{proposal.ticket_id}</TableCell>
      <TableCell>
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: proposal.ticket_id }}
          className="block max-w-summary truncate font-medium text-foreground hover:text-white hover:underline-subtle"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.Summary}
        </Link>
        <CellNote>
          {ticket["Request type"]}
          {warnings > 0 && <WarnCount count={warnings} title={`${warnings} review warning(s)`} />}
        </CellNote>
      </TableCell>
      <TableCell className="min-w-35 whitespace-normal">
        {ticket["Affected Business or IT Services"][0] !== current.form.service && (
          <>
            <OldValue>{ticket["Affected Business or IT Services"][0]}</OldValue>
            <ChangeArrow />
          </>
        )}
        <span className="text-foreground">{current.form.service}</span>
      </TableCell>
      <TableCell>
        {ticket["Work type"] !== current.form.work_type && (
          <>
            <OldValue>{ticket["Work type"]}</OldValue>
            <ChangeArrow />
          </>
        )}
        <span className="text-foreground">{current.form.work_type}</span>
      </TableCell>
      <TableCell>
        <PriorityPill row={row} />
      </TableCell>
      <TableCell className="text-right">
        <Confidence value={proposal.confidence.service} />
      </TableCell>
      <TableCell>
        <StatusPill status={current.status} />
      </TableCell>
      <TableCell className="text-right">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: proposal.ticket_id }}
          aria-label={`Open ${proposal.ticket_id}`}
          className={buttonVariants({ size: "icon" })}
          onClick={(event) => event.stopPropagation()}
        >
          <ArrowUpRight size={16} strokeWidth={1.75} />
        </Link>
      </TableCell>
    </tr>
  );
}

function BoardCard({ row }: { row: TicketRow }) {
  const { ticket, proposal, current } = row;
  const warnings = reviewWarnings(ticket, current.form).length;

  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: proposal.ticket_id }}
      className="grid gap-1.5 rounded-button border bg-elevated px-3 py-2.5 hover:border-border-hover"
    >
      <span className={boardCardRow}>
        <span className={ticketIdText}>{proposal.ticket_id}</span>
        <PriorityPill row={row} />
      </span>
      <b className="line-clamp-2 leading-snug font-medium">{ticket.Summary}</b>
      <small className="text-sm text-muted">
        {current.form.service} · {current.form.work_type}
      </small>
      <span className={boardCardRow}>
        <span className="text-muted">{STATUS_LABELS[current.status]}</span>
        {warnings > 0 && <WarnCount count={warnings} />}
      </span>
    </Link>
  );
}

function WarnCount({ count, title }: { count: number; title?: string }) {
  return (
    <span className="ml-2 inline-flex items-center gap-0.75 text-xs text-warning" title={title}>
      <TriangleAlert size={12} strokeWidth={1.75} />
      {count}
    </span>
  );
}

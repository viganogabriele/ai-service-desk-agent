import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowRight, ArrowUp, ChevronsUpDown, Sparkles } from "lucide-react";
import { serviceInfo } from "../domain";
import {
  ClassifyingPill,
  Initials,
  Pending,
  PriorityBadge,
  SORT_LABELS,
  StatusPill,
  isOpen,
  opensOnClick,
  personName,
  useTicketFilters,
} from "./tickets";
import type { SortKey, TicketRow } from "./tickets";
import { cn } from "../lib/utils";
import { buttonVariants } from "./ui/button";
import { Card, Empty } from "./ui/card";
import { CheckHit, Checkbox } from "./ui/form";

export interface Selection {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

const TH =
  "h-11 px-3 text-left text-xs font-semibold tracking-caps whitespace-nowrap text-muted uppercase first:pl-card-pad last:pr-card-pad";

// Below 860px each row becomes a stacked card; `md:` keeps the table-only treatment off it.
const TD =
  "h-16 border-t border-divider px-3 py-2.5 align-middle text-base whitespace-nowrap text-secondary transition-colors duration-120 ease-soft md:group-hover/row:bg-row md:first:pl-card-pad md:last:pr-card-pad max-md:block max-md:h-auto max-md:w-auto max-md:min-w-0 max-md:border-0 max-md:p-0";

const WRAP = "min-w-35 whitespace-normal";

const NOTE = "mt-0.5 block text-sm text-muted";

const SUMMARY =
  "block max-w-130 truncate font-display text-md font-medium max-md:line-clamp-2 max-md:max-w-none max-md:leading-snug max-md:whitespace-normal";

// Where each cell sits in a stacked row. Without checkboxes the rows drop the empty first column.
const STACKED = {
  withCheck: {
    row: "max-md:grid-cols-queue-row",
    summary: "max-md:col-span-2 max-md:col-start-2 max-md:row-start-1",
    service: "max-md:col-start-2 max-md:row-start-2",
    priority: "max-md:col-start-3 max-md:row-start-2",
    assignee: "max-md:col-start-2 max-md:row-start-3",
    status: "max-md:col-start-3 max-md:row-start-3",
  },
  plain: {
    row: "max-md:grid-cols-queue-row-plain",
    summary: "max-md:col-span-2 max-md:row-start-1",
    service: "max-md:col-start-1 max-md:row-start-2",
    priority: "max-md:col-start-2 max-md:row-start-2",
    assignee: "max-md:col-start-1 max-md:row-start-3",
    status: "max-md:col-start-2 max-md:row-start-3",
  },
};

/**
 * A column header that sorts the queue: the first click sorts in the column's natural order
 * (A to Z, highest priority first, workflow order), the second reverses it, the third goes back to
 * the queue order.
 */
function SortHeader({ column, tip }: { column: SortKey; tip?: string }) {
  const { filters, setFilters } = useTicketFilters();
  const active = filters.sort?.key === column ? filters.sort : null;
  const Icon = active ? (active.descending ? ArrowDown : ArrowUp) : ChevronsUpDown;

  return (
    <th
      className={TH}
      aria-sort={active ? (active.descending ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        className={cn(
          "group/sort -mx-1.5 inline-flex h-7 items-center gap-1 rounded-cell px-1.5 font-semibold tracking-caps uppercase transition-colors duration-120 ease-soft hover:bg-hover hover:text-foreground",
          active && "text-foreground",
        )}
        data-tip={tip}
        onClick={() =>
          setFilters({
            sort: !active
              ? { key: column, descending: false }
              : !active.descending
                ? { key: column, descending: true }
                : null,
          })
        }
      >
        {SORT_LABELS[column]}
        <Icon
          size={12}
          strokeWidth={2.25}
          aria-hidden="true"
          className={cn(
            !active &&
              "opacity-0 transition-opacity duration-120 ease-soft group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100 touch:opacity-100",
          )}
        />
      </button>
    </th>
  );
}

/**
 * Queue table. Rows arrive already ordered, and the headers change that order through the shared
 * filters; pass `selection` to add checkboxes for bulk actions.
 */
export function TicketTable({ rows, selection }: { rows: TicketRow[]; selection?: Selection }) {
  const ids = rows.map((row) => row.id);
  const allSelected = ids.length > 0 && ids.every((id) => selection?.selected.has(id));
  const someSelected = ids.some((id) => selection?.selected.has(id));

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-230 border-collapse max-md:min-w-0">
          <thead className="max-md:hidden">
            <tr>
              {selection && (
                <th className={cn(TH, "w-10 pr-0")}>
                  <CheckHit>
                    <Checkbox
                      aria-label="Select all shown tickets"
                      checked={allSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = someSelected && !allSelected;
                      }}
                      onChange={selection.onToggleAll}
                    />
                  </CheckHit>
                </th>
              )}
              <SortHeader column="ticket" />
              <SortHeader column="priority" tip="Calculated from urgency and impact" />
              <SortHeader column="service" />
              <SortHeader column="assignee" />
              <SortHeader column="status" />
              <th className={cn(TH, "w-12")} />
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((row) => (
              <TableRow key={row.id} row={row} selection={selection} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No tickets match these filters.</Empty>}
      </div>
    </Card>
  );
}

function TableRow({ row, selection }: { row: TicketRow; selection?: Selection }) {
  const navigate = useNavigate();
  const { ticket, proposal, current, id, arrival } = row;
  const declared = ticket["Affected Business or IT Services"][0];
  const selected = selection?.selected.has(id) ?? false;
  const open = () => void navigate({ to: "/tickets/$ticketId", params: { ticketId: id } });
  const place = selection ? STACKED.withCheck : STACKED.plain;
  const td = cn(TD, selected && "md:bg-primary-subtle md:group-hover/row:bg-primary-subtle");
  // A simulated ticket cannot be opened until the AI has classified it.
  const classifying = arrival === "classifying";
  // The AI's values replace the placeholders.
  const decided = cn(td, arrival === "classified" && "animate-fade-in");

  return (
    <tr
      className={cn(
        "max-md:grid max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:border-t max-md:border-divider max-md:px-card-pad max-md:py-3.5",
        classifying ? "animate-arrive cursor-progress" : "group/row cursor-pointer",
        place.row,
      )}
      aria-disabled={classifying || undefined}
      aria-busy={classifying || undefined}
      onClick={(event) => {
        if (!classifying && opensOnClick(event)) open();
      }}
    >
      {selection && (
        <td
          className={cn(
            td,
            "w-10 pr-0 max-md:col-start-1 max-md:row-start-1 max-md:self-start max-md:pt-0.5",
          )}
        >
          <CheckHit>
            <Checkbox
              aria-label={`Select ${id}`}
              checked={selected}
              disabled={classifying || !isOpen(current.status)}
              onChange={() => selection.onToggle(id)}
            />
          </CheckHit>
        </td>
      )}
      <td className={cn(td, WRAP, "min-w-80", place.summary)}>
        {classifying ? (
          <span className={cn(SUMMARY, "text-secondary")}>{ticket.Summary}</span>
        ) : (
          <Link
            to="/tickets/$ticketId"
            params={{ ticketId: id }}
            className={cn(
              SUMMARY,
              "text-foreground transition-colors duration-150 ease-soft group-hover/row:text-primary-text",
            )}
          >
            {ticket.Summary}
          </Link>
        )}
        <small className={NOTE}>
          <span className="text-sm font-medium whitespace-nowrap text-muted tabular-nums">
            {id}
          </span>{" "}
          · {ticket["Request type"]} · {personName(ticket.Reporter)}
        </small>
      </td>
      <td className={cn(decided, place.priority, "max-md:justify-self-end")}>
        {classifying ? (
          <Pending className="h-5.5 w-20" />
        ) : (
          <PriorityBadge triage={current.triage} />
        )}
      </td>
      <td className={cn(decided, WRAP, place.service)}>
        {classifying ? (
          <>
            <Pending className="h-3.5 w-36" />
            <Pending className="mt-2 w-24" />
          </>
        ) : (
          <>
            <span className="text-foreground">{current.triage.service}</span>
            <small className={NOTE}>
              {declared && proposal && proposal.proposal.service !== declared ? (
                <span className="inline-flex items-center gap-1 text-primary-text">
                  <Sparkles size={11} strokeWidth={2} />
                  AI changed from {declared}
                </span>
              ) : (
                serviceInfo(current.triage.service)?.[1]
              )}
            </small>
          </>
        )}
      </td>
      <td className={cn(decided, place.assignee)}>
        {classifying ? (
          <span className="inline-flex items-center gap-2">
            <Pending className="size-6 rounded-full" />
            <Pending className="w-24" />
          </span>
        ) : current.triage.assignee ? (
          <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
            <Initials email={current.triage.assignee} />
            <span className="truncate">{personName(current.triage.assignee)}</span>
          </span>
        ) : (
          <span className="text-muted">Unassigned</span>
        )}
      </td>
      <td className={cn(decided, place.status, "max-md:justify-self-end")}>
        {classifying ? <ClassifyingPill /> : <StatusPill status={current.status} />}
      </td>
      <td className={cn(td, "w-12 text-right max-md:hidden")}>
        <span
          className={cn(
            buttonVariants({ size: "icon" }),
            "-translate-x-1.5 border-transparent bg-transparent opacity-0 group-hover/row:translate-x-0 group-hover/row:text-primary-text group-hover/row:opacity-100",
          )}
          aria-hidden="true"
        >
          <ArrowRight size={16} strokeWidth={1.75} />
        </span>
      </td>
    </tr>
  );
}

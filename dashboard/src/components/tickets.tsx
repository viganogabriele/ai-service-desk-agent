import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Flag, Search, X } from "lucide-react";
import { useDashboard } from "../state";
import { cn } from "../lib/utils";
import type { Review } from "../state";
import {
  LEVELS,
  OPEN_STATUSES,
  SERVICES,
  STATUSES,
  STATUS_DOTS,
  STATUS_HELP,
  STATUS_LABELS,
  serviceInfo,
  triageLevel,
} from "../domain";
import type { Level, Status, Triage } from "../domain";
import type { QueueItem } from "../lib/queue";
import { Select } from "./select";
import { Badge, Dot, avatarVariants } from "./ui/badge";
import type { BadgeTone } from "./ui/badge";
import { Kbd } from "./ui/form";

export interface TicketFilters {
  query: string;
  status: Status | "all" | "open";
  service: string;
  rating: "all" | "Critical" | "Non-Critical";
  change: "all" | "service" | "work";
  view: "table" | "board" | "priority";
  // A table column the operator clicked; null keeps the queue order.
  sort: TicketSort | null;
}

export type SortKey = "ticket" | "priority" | "service" | "assignee" | "status";

export interface TicketSort {
  key: SortKey;
  descending: boolean;
}

export const SORT_LABELS: Record<SortKey, string> = {
  ticket: "Ticket",
  priority: "Priority",
  service: "Service",
  assignee: "Assignee",
  status: "Status",
};

export const DEFAULT_FILTERS: TicketFilters = {
  query: "",
  status: "all",
  service: "all",
  rating: "all",
  change: "all",
  view: "priority",
  sort: null,
};

interface FiltersContextValue {
  filters: TicketFilters;
  setFilters: (changed: Partial<TicketFilters>) => void;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

/** Keeps queue filters alive while moving between the list and a single ticket. */
export function TicketFiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setAll] = useState(DEFAULT_FILTERS);

  return (
    <FiltersContext.Provider
      value={{
        filters,
        setFilters: (changed) => setAll((current) => ({ ...current, ...changed })),
      }}
    >
      {children}
    </FiltersContext.Provider>
  );
}

export function useTicketFilters() {
  const context = useContext(FiltersContext);

  if (!context) throw new Error("Ticket filters context missing");

  return context;
}

export interface TicketRow extends QueueItem {
  index: number;
  id: string;
  current: Review;
}

export const isOpen = (status: Status) => OPEN_STATUSES.includes(status);

/** Whether anything narrows the queue beyond the chosen view. */
export const isFiltered = (filters: TicketFilters) =>
  filters.query !== DEFAULT_FILTERS.query ||
  filters.status !== DEFAULT_FILTERS.status ||
  filters.service !== DEFAULT_FILTERS.service ||
  filters.rating !== DEFAULT_FILTERS.rating ||
  filters.change !== DEFAULT_FILTERS.change;

/**
 * A plain click on a row or card itself: not on a control inside it, not from a menu it portals
 * out (React bubbles those through the tree), without modifier keys, and not the mouse-up that
 * ends a text selection.
 */
export function opensOnClick(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return false;

  if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target))
    return false;

  return !event.target.closest("a, button, input, label") && !window.getSelection()?.toString();
}

// Priority and status sort by their position in the scale, so digits compare as numbers.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const SORT_VALUES: Record<SortKey, (row: TicketRow) => string | null> = {
  ticket: (row) => row.id,
  priority: (row) => {
    const level = triageLevel(row.current.triage);

    return level ? String(LEVELS.indexOf(level)) : null;
  },
  service: (row) => row.current.triage.service || null,
  assignee: (row) => (row.current.triage.assignee ? personName(row.current.triage.assignee) : null),
  status: (row) => String(STATUSES.indexOf(row.current.status)),
};

/** Tickets without a value (no priority, no assignee) stay at the bottom in both directions. */
function bySort(a: TicketRow, b: TicketRow, sort: TicketSort) {
  const first = SORT_VALUES[sort.key](a);
  const second = SORT_VALUES[sort.key](b);

  if (first === null || second === null) return Number(first === null) - Number(second === null);

  return collator.compare(first, second) * (sort.descending ? -1 : 1);
}

// Open tickets first, then by priority, then in the order they arrived.
const byQueue = (a: TicketRow, b: TicketRow) =>
  Number(!isOpen(a.current.status)) - Number(!isOpen(b.current.status)) ||
  priorityRank(a.current.triage) - priorityRank(b.current.triage) ||
  a.index - b.index;

export function useTicketRows() {
  const { data, review, proposalFor, idOf, classification } = useDashboard();
  const { filters } = useTicketFilters();
  const needle = filters.query.trim().toLowerCase();
  // The board has no column headers to show a sort, so it keeps the queue order.
  const sort = filters.view === "board" ? null : filters.sort;

  const rows: TicketRow[] = data.challenge.map((ticket, index) => ({
    index,
    id: idOf(index),
    ticket,
    proposal: proposalFor(index),
    current: review(index),
    classification: classification(index),
  }));

  const visible = rows
    .filter((row) => {
      const { status, triage } = row.current;

      if (filters.status === "open" && !isOpen(status)) return false;

      if (filters.status !== "all" && filters.status !== "open" && status !== filters.status)
        return false;

      if (filters.service !== "all" && triage.service !== filters.service) return false;

      if (filters.rating !== "all" && serviceInfo(triage.service)?.[2] !== filters.rating)
        return false;

      if (
        filters.change === "service" &&
        (!row.proposal ||
          row.proposal.proposal.service === row.ticket["Affected Business or IT Services"][0])
      )
        return false;

      if (
        filters.change === "work" &&
        (!row.proposal || row.proposal.proposal.work_type === row.ticket["Work type"])
      )
        return false;

      if (
        needle &&
        ![
          row.id,
          row.ticket.Summary,
          row.ticket.Description,
          row.ticket.Reporter,
          row.ticket["Request type"],
          triage.service,
          triage.assignee,
        ].some((text) => text?.toLowerCase().includes(needle))
      )
        return false;

      return true;
    })
    .sort((a, b) => (sort ? bySort(a, b, sort) : 0) || byQueue(a, b));

  return { rows, visible };
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className="inline-flex items-center gap-1.75 text-sm font-medium whitespace-nowrap text-muted"
      data-tip={STATUS_HELP[status]}
    >
      <Dot tone={STATUS_DOTS[status]} className="size-1.75" />
      {STATUS_LABELS[status]}
    </span>
  );
}

const priorityRank = (triage: Triage) => {
  const level = triageLevel(triage);

  return level ? LEVELS.indexOf(level) : LEVELS.length;
};

const LEVEL_TONES: Record<Level, BadgeTone> = {
  Highest: "highest",
  High: "high",
  Medium: "medium",
  Low: "low",
  Lowest: "lowest",
};

/** Priority is never free input: it is the matrix value of urgency × impact. */
export function PriorityBadge({ triage }: { triage: Triage }) {
  const level = triageLevel(triage);
  const basis = `Urgency ${triage.urgency ?? "unknown"} × Impact ${triage.impact ?? "unknown"}`;

  return (
    <Badge
      tone={level ? LEVEL_TONES[level] : "none"}
      data-tip={level ? `${level} priority · ${basis}` : "No priority in Jira"}
    >
      <Flag size={12} strokeWidth={2.25} />
      {level ?? "No priority"}
    </Badge>
  );
}

export function CriticalBadge() {
  return (
    <Badge tone="critical" data-tip="Business-critical service">
      <Dot tone="danger" />
      Critical service
    </Badge>
  );
}

export function Initials({ email, small = false }: { email: string | null; small?: boolean }) {
  const size = small ? "sm" : "default";

  if (!email) return <span className={avatarVariants({ size, empty: true })} aria-hidden="true" />;
  const [first = "", last = ""] = email.split("@")[0].split(".");

  return (
    <span className={avatarVariants({ size })} aria-hidden="true">
      {(first[0] ?? "").toUpperCase()}
      {(last[0] ?? "").toUpperCase()}
    </span>
  );
}

export const personName = (email: string | null) =>
  (email ?? "")
    .split("@")[0]
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function SearchField({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { filters, setFilters } = useTicketFilters();
  const input = useRef<HTMLInputElement>(null);

  // "/" jumps to the search field from anywhere on the page that is not already taking text.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, [contenteditable], [role=listbox], [aria-modal=true]",
        )
      )
        return;

      event.preventDefault();
      input.current?.focus();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label
      className={cn(
        "group/search flex h-10 w-85 max-w-full items-center gap-2.5 rounded-pill border bg-surface px-3.5 text-sm text-muted transition duration-120 ease-out focus-within:border-ring focus-within:ring-3 focus-within:ring-primary-subtle pointer-coarse:h-10.5",
        compact && "w-full",
        className,
      )}
    >
      <Search size={15} strokeWidth={1.75} />
      <span className="sr-only">Search tickets</span>
      <input
        ref={input}
        type="search"
        className="min-w-0 flex-1 appearance-none bg-transparent font-normal text-foreground outline-none pointer-coarse:text-lg"
        placeholder="Search tickets, reporters, services…"
        value={filters.query}
        onChange={(event) => setFilters({ query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFilters({ query: "" });
            event.currentTarget.blur();
          }
        }}
      />
      {filters.query ? (
        <button
          type="button"
          className="-mr-1 grid size-5 flex-none place-items-center rounded-full bg-active text-secondary hover:bg-border-hover hover:text-foreground"
          aria-label="Clear search"
          onClick={() => setFilters({ query: "" })}
        >
          <X size={14} strokeWidth={2} />
        </button>
      ) : (
        <Kbd
          className="-mr-1 flex-none transition-opacity duration-150 ease-soft group-focus-within/search:opacity-0 touch:hidden max-sm:hidden"
          aria-hidden="true"
        >
          /
        </Kbd>
      )}
    </label>
  );
}

// Filters share a row with the search field, and split a phone-width row evenly.
const FILTER_CLASS = "min-w-37.5 max-sm:min-w-0 max-sm:flex-1";

export function StatusFilter() {
  const { filters, setFilters } = useTicketFilters();
  const { rows } = useTicketRows();

  return (
    <Select
      label="Status"
      hideLabel
      className={FILTER_CLASS}
      active={filters.status !== "all"}
      value={filters.status}
      onChange={(status) => setFilters({ status })}
      options={[
        { value: "all", label: "All tickets", hint: String(rows.length) },
        {
          value: "open",
          label: "Open tickets",
          hint: String(rows.filter((row) => isOpen(row.current.status)).length),
        },
        ...STATUSES.map((status) => ({
          value: status,
          label: STATUS_LABELS[status],
          hint: String(rows.filter((row) => row.current.status === status).length),
        })),
      ]}
    />
  );
}

export function FilterSelects() {
  const { data } = useDashboard();
  const { filters, setFilters } = useTicketFilters();
  const hasProposals = data.proposals.some(Boolean);

  return (
    <>
      <Select
        label="Service"
        hideLabel
        className={FILTER_CLASS}
        active={filters.service !== "all"}
        value={filters.service}
        onChange={(service) => setFilters({ service })}
        options={[
          { value: "all", label: "All services" },
          ...SERVICES.map(([name, team]) => ({ value: name, label: name, hint: team })),
        ]}
      />
      <Select
        label="Service rating"
        hideLabel
        className={FILTER_CLASS}
        active={filters.rating !== "all"}
        value={filters.rating}
        onChange={(rating) => setFilters({ rating })}
        options={[
          { value: "all", label: "Any rating" },
          { value: "Critical", label: "Critical services" },
          { value: "Non-Critical", label: "Non-critical services" },
        ]}
      />
      {hasProposals && (
        <Select
          label="AI changes"
          hideLabel
          className={FILTER_CLASS}
          active={filters.change !== "all"}
          value={filters.change}
          onChange={(change) => setFilters({ change })}
          options={[
            { value: "all", label: "Any AI suggestion" },
            { value: "service", label: "AI changed the service" },
            { value: "work", label: "AI changed the work type" },
          ]}
        />
      )}
    </>
  );
}

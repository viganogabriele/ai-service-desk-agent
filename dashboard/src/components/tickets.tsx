import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  priority,
  serviceInfo,
} from "../domain";
import type { IncomingTicket, Level, Proposal, Status, Triage } from "../domain";
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
}

const DEFAULT_FILTERS: TicketFilters = {
  query: "",
  status: "all",
  service: "all",
  rating: "all",
  change: "all",
  view: "priority",
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

export interface TicketRow {
  index: number;
  id: string;
  ticket: IncomingTicket;
  proposal: Proposal | null;
  current: Review;
}

export const isOpen = (status: Status) => OPEN_STATUSES.includes(status);

export function useTicketRows() {
  const { data, review, proposalFor, idOf } = useDashboard();
  const { filters } = useTicketFilters();
  const needle = filters.query.trim().toLowerCase();

  const rows: TicketRow[] = data.challenge.map((ticket, index) => ({
    index,
    id: idOf(index),
    ticket,
    proposal: proposalFor(index),
    current: review(index),
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
    .sort(
      (a, b) =>
        Number(!isOpen(a.current.status)) - Number(!isOpen(b.current.status)) ||
        priorityRank(a.current.triage) - priorityRank(b.current.triage) ||
        a.index - b.index,
    );

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

// Tickets without urgency or impact in Jira keep the priority Jira holds.
export const levelOf = (triage: Triage) =>
  priority(triage.urgency, triage.impact) ?? triage.priority;

const priorityRank = (triage: Triage) => {
  const level = levelOf(triage);

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
  const level = levelOf(triage);
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

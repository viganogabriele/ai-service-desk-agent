import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useDashboard } from "../state";
import type { Review } from "../state";
import {
  LEVELS,
  OPEN_STATUSES,
  PRIORITY_DOTS,
  SERVICES,
  STATUSES,
  STATUS_DOTS,
  STATUS_HELP,
  STATUS_LABELS,
  priority,
  serviceInfo,
} from "../domain";
import type { IncomingTicket, Proposal, Status, Triage } from "../domain";
import { Select } from "./select";

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
  status: "open",
  service: "all",
  rating: "all",
  change: "all",
  view: "table",
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
    <span className="pill" data-tip={STATUS_HELP[status]}>
      <i className={`dot ${STATUS_DOTS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// Tickets without urgency or impact in Jira keep the priority Jira holds.
const levelOf = (triage: Triage) => priority(triage.urgency, triage.impact) ?? triage.priority;

const priorityRank = (triage: Triage) => {
  const level = levelOf(triage);

  return level ? LEVELS.indexOf(level) : LEVELS.length;
};

/** Priority is never free input: it is the matrix value of urgency × impact. */
export function PriorityPill({ triage, detail = false }: { triage: Triage; detail?: boolean }) {
  const level = levelOf(triage);
  const basis = `Urgency ${triage.urgency} × Impact ${triage.impact}`;

  return (
    <span className="priority" data-tip={`${level} priority · ${basis}`}>
      <span className="pill">
        <i className={`dot ${level ? PRIORITY_DOTS[level] : ""}`} />
        {level}
      </span>
      {detail && <small>{basis}</small>}
    </span>
  );
}

export function Initials({ email }: { email: string | null }) {
  if (!email) return <span className="avatar empty" aria-hidden="true" />;
  const [first = "", last = ""] = email.split("@")[0].split(".");

  return (
    <span className="avatar" aria-hidden="true">
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

export function SearchField({ compact = false }: { compact?: boolean }) {
  const { filters, setFilters } = useTicketFilters();

  return (
    <label className={compact ? "search compact" : "search"}>
      <Search size={14} strokeWidth={1.75} />
      <span className="sr-only">Search tickets</span>
      <input
        type="search"
        placeholder="Search tickets, reporters, services…"
        value={filters.query}
        onChange={(event) => setFilters({ query: event.target.value })}
      />
      {filters.query && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => setFilters({ query: "" })}
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </label>
  );
}

export function StatusFilter() {
  const { filters, setFilters } = useTicketFilters();
  const { rows } = useTicketRows();

  return (
    <Select
      label="Status"
      hideLabel
      value={filters.status}
      onChange={(status) => setFilters({ status })}
      options={[
        {
          value: "open",
          label: "Open tickets",
          hint: String(rows.filter((row) => isOpen(row.current.status)).length),
        },
        { value: "all", label: "All tickets", hint: String(rows.length) },
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

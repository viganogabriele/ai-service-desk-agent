import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { useDashboard } from "../state";
import type { Review } from "../state";
import {
  COMPLETED_STATUSES,
  PRIORITY_DOTS,
  SERVICES,
  STATUS_DOTS,
  STATUS_LABELS,
  priority,
  serviceInfo,
} from "../domain";
import type { Proposal, ReviewStatus, Ticket } from "../domain";

export interface TicketFilters {
  query: string;
  status: ReviewStatus | "all" | "open";
  service: string;
  rating: string;
  change: string;
  view: "table" | "board";
}

const DEFAULT_FILTERS: TicketFilters = {
  query: "",
  status: "all",
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
  ticket: Ticket;
  proposal: Proposal;
  current: Review;
}

export const isOpen = (status: ReviewStatus) => !COMPLETED_STATUSES.includes(status);

export function useTicketRows() {
  const { data, review, proposalFor } = useDashboard();
  const { filters } = useTicketFilters();
  const needle = filters.query.trim().toLowerCase();

  const rows: TicketRow[] = data.challenge.map((ticket, index) => ({
    index,
    ticket,
    proposal: proposalFor(index),
    current: review(index),
  }));

  const visible = rows
    .filter((row) => {
      const status = row.current.status;

      if (filters.status === "open" && !isOpen(status)) return false;

      if (filters.status !== "all" && filters.status !== "open" && status !== filters.status)
        return false;

      if (filters.service !== "all" && row.current.form.service !== filters.service) return false;

      if (filters.rating !== "all" && serviceInfo(row.current.form.service)?.[2] !== filters.rating)
        return false;

      if (
        filters.change === "service" &&
        row.ticket["Affected Business or IT Services"][0] === row.current.form.service
      )
        return false;

      if (filters.change === "work" && row.ticket["Work type"] === row.current.form.work_type)
        return false;

      if (
        needle &&
        ![
          row.proposal.ticket_id,
          row.ticket.Summary,
          row.ticket.Description,
          row.ticket.Reporter,
          row.ticket["Request type"],
          row.current.form.service,
        ].some((text) => text.toLowerCase().includes(needle))
      )
        return false;

      return true;
    })
    .sort(
      (a, b) =>
        Number(!isOpen(a.current.status)) - Number(!isOpen(b.current.status)) ||
        (a.proposal.confidence.service ?? 1) - (b.proposal.confidence.service ?? 1) ||
        a.index - b.index,
    );

  return { rows, visible };
}

export function StatusPill({ status }: { status: ReviewStatus }) {
  return (
    <span className="pill">
      <i className={`dot ${STATUS_DOTS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityPill({ row }: { row: TicketRow }) {
  const level = priority(row.current.form.urgency, row.current.form.impact);

  return (
    <span className="pill">
      <i className={`dot ${PRIORITY_DOTS[level]}`} />
      {level}
    </span>
  );
}

export function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">Not measured</span>;
  const percent = Math.round(value * 100);

  return (
    <span className="confidence-cell">
      {percent}%
      <span className="meter neutral">
        <span style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

export function SearchField({ compact = false }: { compact?: boolean }) {
  const { filters, setFilters } = useTicketFilters();

  return (
    <label className={compact ? "search compact" : "search"}>
      <Search size={14} strokeWidth={1.75} />
      <span className="sr-only">Search tickets</span>
      <input
        type="search"
        placeholder="Search id, summary, reporter…"
        value={filters.query}
        onChange={(event) => setFilters({ query: event.target.value })}
      />
    </label>
  );
}

export function StatusSelect() {
  const { filters, setFilters } = useTicketFilters();
  const { rows } = useTicketRows();

  return (
    <label>
      <span className="sr-only">Review status</span>
      <select
        value={filters.status}
        onChange={(event) => {
          const value = event.target.value;

          // SAFETY: STATUS_LABELS is keyed by every ReviewStatus, so its keys are ReviewStatus values.
          const status =
            value === "all" || value === "open"
              ? value
              : (Object.keys(STATUS_LABELS) as ReviewStatus[]).find((key) => key === value);

          setFilters({ status: status ?? "all" });
        }}
      >
        <option value="all">All statuses · {rows.length}</option>
        <option value="open">
          Open · {rows.filter((row) => isOpen(row.current.status)).length}
        </option>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <option value={key} key={key}>
            {label} · {rows.filter((row) => row.current.status === key).length}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSelects() {
  const { filters, setFilters } = useTicketFilters();

  return (
    <>
      <label>
        <span className="sr-only">Proposed service</span>
        <select
          value={filters.service}
          onChange={(event) => setFilters({ service: event.target.value })}
        >
          <option value="all">All services</option>
          {SERVICES.map(([name]) => (
            <option value={name} key={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Rating</span>
        <select
          value={filters.rating}
          onChange={(event) => setFilters({ rating: event.target.value })}
        >
          <option value="all">All ratings</option>
          <option>Critical</option>
          <option>Non-Critical</option>
        </select>
      </label>
      <label>
        <span className="sr-only">Changes</span>
        <select
          value={filters.change}
          onChange={(event) => setFilters({ change: event.target.value })}
        >
          <option value="all">Any change</option>
          <option value="service">Service changed</option>
          <option value="work">Work type changed</option>
        </select>
      </label>
    </>
  );
}

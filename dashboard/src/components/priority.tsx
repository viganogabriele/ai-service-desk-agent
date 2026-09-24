import { useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronsRight, Layers, Sparkles, UserRound } from "lucide-react";
import { useDashboard } from "../state";
import { LEVELS, STATUS_LABELS, priority, serviceInfo } from "../domain";
import type { Level } from "../domain";
import { Initials, PriorityBadge, StatusPill, personName } from "./tickets";
import type { TicketRow } from "./tickets";
import { TicketTable } from "./table";
import { Menu } from "./ui";

// A ticket needs action now when it is high priority, or medium priority on a critical service.
const isUrgent = (level: Level | null, critical: boolean) =>
  level === "Highest" || level === "High" || (critical && level === "Medium");

interface Scored {
  row: TicketRow;
  // The one thing worth knowing before opening the ticket, if anything.
  note: { text: string; ai: boolean } | null;
  age: number | null;
  // Lower is more important: priority first, then critical services, then the oldest ticket.
  rank: [number, number, number];
}

const DAY = 24 * 60 * 60 * 1000;

/** Whole days since the ticket was created; the export uses "YYYY-MM-DD HH:mm" in local time. */
function ageInDays(created: string | null) {
  if (!created) return null;
  const time = new Date(created.replace(" ", "T")).getTime();

  return Number.isNaN(time) ? null : Math.max(0, Math.floor((Date.now() - time) / DAY));
}

/** Open, unrouted tickets that need an operator now; null for the rest. */
function score(row: TicketRow): Scored | null {
  const { status, triage } = row.current;

  if (status !== "new" && status !== "in_progress") return null;
  const level = priority(triage.urgency, triage.impact);
  const critical = serviceInfo(triage.service)?.[2] === "Critical";

  if (!isUrgent(level, critical)) return null;
  const age = ageInDays(row.ticket["Created date"]);
  const declaredService = row.ticket["Affected Business or IT Services"][0];
  const declaredWork = row.ticket["Work type"];
  const serviceChanged = row.proposal !== null && row.proposal.proposal.service !== declaredService;
  const workChanged = row.proposal !== null && row.proposal.proposal.work_type !== declaredWork;

  let note: Scored["note"] = null;

  if (serviceChanged) note = { text: `AI moved it from ${declaredService}`, ai: true };
  else if (workChanged) note = { text: `AI changed it from ${declaredWork}`, ai: true };
  else if (!triage.assignee) note = { text: "No assignee yet", ai: false };

  return {
    row,
    note,
    age,
    rank: [level ? LEVELS.indexOf(level) : LEVELS.length, critical ? 0 : 1, -(age ?? 0)],
  };
}

function byRank(a: Scored, b: Scored) {
  return a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2];
}

/**
 * A wheel mouse only sends vertical deltas, so the card strip cannot be scrolled at all on a
 * machine without a trackpad. Steer those deltas sideways; a horizontal delta or shift+wheel is
 * already handled by the browser. At either end the wheel goes back to scrolling the page.
 */
function useSidewaysWheel() {
  // A callback ref, so the listener follows the strip as it mounts and unmounts with the filters.
  return useCallback((row: HTMLDivElement | null) => {
    if (!row) return;

    // Where the smooth scroll in flight will land, so quick notches add up instead of restarting.
    let target: number | null = null;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.deltaX !== 0 || event.shiftKey) return;
      const limit = row.scrollWidth - row.clientWidth;
      const from = target ?? row.scrollLeft;

      if (event.deltaY < 0 ? from <= 1 : from >= limit - 1) return;
      event.preventDefault();
      // Move a whole card per notch: the strip snaps to card edges, so a wheel-sized nudge would
      // snap straight back to the card it started from.
      const [first, second] = row.children;

      const card = second
        ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
        : row.clientWidth;

      const index = Math.round(from / card) + Math.sign(event.deltaY);

      target = Math.min(limit, Math.max(0, index * card));
      row.scrollTo({ left: target, behavior: "smooth" });
    };

    const onScrollEnd = () => {
      target = null;
    };

    row.addEventListener("wheel", onWheel, { passive: false });
    row.addEventListener("scrollend", onScrollEnd);

    return () => {
      row.removeEventListener("wheel", onWheel);
      row.removeEventListener("scrollend", onScrollEnd);
    };
  }, []);
}

/**
 * Two ways in: a row of cards for the tickets that need action now, then the whole queue as a
 * table ordered by priority.
 */
export function PriorityView({ rows }: { rows: TicketRow[] }) {
  const urgent = rows.flatMap((row) => score(row) ?? []).sort(byRank);
  const lane = useSidewaysWheel();

  if (rows.length === 0) return <div className="empty">No tickets match these filters.</div>;

  return (
    <div className="priority-view">
      <section className="priority-lane" aria-labelledby="lane-action">
        <div className="section-head">
          <h2 id="lane-action">
            Action Required
            <span className="count">{urgent.length}</span>
          </h2>
          <p>High priority, or medium priority on a critical service, not yet routed</p>
        </div>
        {urgent.length > 0 ? (
          <div
            ref={lane}
            className="ticket-row"
            role="group"
            aria-labelledby="lane-action"
            tabIndex={0}
          >
            {urgent.map((item) => (
              <TicketCard key={item.row.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="empty">Nothing needs immediate action.</div>
        )}
      </section>
      <section className="priority-lane" aria-labelledby="lane-all">
        <div className="section-head">
          <h2 id="lane-all" className="neutral">
            All tickets
            <span className="count">{rows.length}</span>
          </h2>
          <p>Ordered by priority, open tickets first</p>
        </div>
        <TicketTable rows={rows} />
      </section>
    </div>
  );
}

function TicketCard({ item }: { item: Scored }) {
  const { assign } = useDashboard();
  const { row, note, age } = item;
  const { ticket, current, id, index } = row;
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "the service team";

  return (
    <article className="ticket-card urgent">
      <div className="ticket-card-head">
        <PriorityBadge triage={triage} />
        <StatusPill status={current.status} />
      </div>
      <Link to="/tickets/$ticketId" params={{ ticketId: id }} className="ticket-card-title">
        {ticket.Summary}
      </Link>
      <div className="tiles">
        <div className="tile">
          <span className="tile-label">
            <Layers size={12} strokeWidth={2} />
            Service
          </span>
          <span className="tile-value">
            {info?.[2] === "Critical" && (
              <i className="dot red" data-tip="Business-critical service" />
            )}
            <span>{triage.service || "Unknown"}</span>
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">
            <UserRound size={12} strokeWidth={2} />
            Requested by
          </span>
          <span className="tile-value">
            <Initials email={ticket.Reporter} />
            <span>{personName(ticket.Reporter) || "Unknown"}</span>
          </span>
        </div>
      </div>
      {(note || age !== null) && (
        <div className="ticket-card-note">
          {note && (
            <>
              {note.ai && <Sparkles size={13} strokeWidth={2} />}
              <span className="note-text">{note.text}</span>
            </>
          )}
          {age !== null && (
            <span className="age num" data-tip={`Opened ${ticket["Created date"]}`}>
              {age === 0 ? "Opened today" : `Open for ${age} day${age === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      )}
      <div className="ticket-card-foot">
        <Link to="/tickets/$ticketId" params={{ ticketId: id }} className="button primary">
          <ChevronsRight size={16} strokeWidth={2.25} />
          Review classification
        </Link>
        <Menu
          label={`More actions for ${id}`}
          items={[
            {
              label: `Assign to ${team}${triage.assignee ? ` · ${personName(triage.assignee)}` : ""}`,
              onSelect: () => assign(index),
            },
            {
              label: `Copy ticket key ${id}`,
              onSelect: () => void navigator.clipboard.writeText(id),
            },
          ]}
        />
      </div>
      <span className="sr-only">{STATUS_LABELS[current.status]}</span>
    </article>
  );
}

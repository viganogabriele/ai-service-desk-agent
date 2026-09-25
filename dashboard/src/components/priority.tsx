import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Layers,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useDashboard } from "../state";
import { LEVELS, STATUS_LABELS, priority, serviceInfo } from "../domain";
import type { Level } from "../domain";
import { Initials, PriorityBadge, StatusPill, levelOf, personName } from "./tickets";
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
 * Scroll state and paging for the card strip. The strip only scrolls sideways on its own (trackpad,
 * shift+wheel, keyboard); a vertical wheel always scrolls the page, and the arrows page by the
 * cards in view for a mouse without a horizontal wheel.
 */
function useStrip(count: number) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    if (!strip) return;

    const update = () => {
      const limit = strip.scrollWidth - strip.clientWidth;

      setAtStart(strip.scrollLeft <= 1);
      setAtEnd(strip.scrollLeft >= limit - 1);
    };

    update();
    const observer = new ResizeObserver(update);

    observer.observe(strip);
    strip.addEventListener("scroll", update, { passive: true });

    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", update);
    };
  }, [strip, count]);

  const page = (direction: 1 | -1) => {
    if (!strip) return;
    const [first, second] = strip.children;

    const card = second
      ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
      : strip.clientWidth;

    const cards = Math.max(1, Math.floor(strip.clientWidth / card));

    strip.scrollBy({ left: direction * cards * card, behavior: "smooth" });
  };

  return { attach: setStrip, atStart, atEnd, page };
}

/**
 * Two ways in: a row of cards for the tickets that need action now, then the whole queue as a
 * table ordered by priority.
 */
export function PriorityView({ rows }: { rows: TicketRow[] }) {
  const urgent = rows.flatMap((row) => score(row) ?? []).sort(byRank);
  const { attach, atStart, atEnd, page } = useStrip(urgent.length);

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
          {!(atStart && atEnd) && (
            <span className="strip-nav push">
              <button
                className="icon-button"
                aria-label="Previous cards"
                disabled={atStart}
                onClick={() => page(-1)}
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <button
                className="icon-button"
                aria-label="Next cards"
                disabled={atEnd}
                onClick={() => page(1)}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
        {urgent.length > 0 ? (
          <div
            ref={attach}
            className="ticket-row"
            data-more-before={atStart ? undefined : ""}
            data-more-after={atEnd ? undefined : ""}
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
          <h2 id="lane-all">
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
    <article className="ticket-card" data-level={levelOf(triage)?.toLowerCase()}>
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

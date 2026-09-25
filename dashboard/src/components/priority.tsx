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
import { cn } from "../lib/utils";
import { Dot } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Empty } from "./ui/card";
import { SectionCount, SectionHead, SectionText, SectionTitle } from "./ui/section";
import { Tile, TileLabel, TileValue, Tiles } from "./ui/tile";

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

  if (rows.length === 0) return <Empty>No tickets match these filters.</Empty>;

  return (
    <div className="grid gap-section">
      <section className="min-w-0" aria-labelledby="lane-action">
        <SectionHead>
          <SectionTitle id="lane-action">
            Action Required
            <SectionCount>{urgent.length}</SectionCount>
          </SectionTitle>
          <SectionText>
            High priority, or medium priority on a critical service, not yet routed
          </SectionText>
          {!(atStart && atEnd) && (
            // Touch screens swipe the card strip, so its arrows are only for a mouse.
            <span className="ml-auto inline-flex gap-2 touch:hidden max-sm:hidden">
              <Button
                size="icon"
                className="bg-surface"
                aria-label="Previous cards"
                disabled={atStart}
                onClick={() => page(-1)}
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </Button>
              <Button
                size="icon"
                className="bg-surface"
                aria-label="Next cards"
                disabled={atEnd}
                onClick={() => page(1)}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </Button>
            </span>
          )}
        </SectionHead>
        {urgent.length > 0 ? (
          // One row of cards, the Figma width, scrolling sideways when there are more than fit.
          <div
            ref={attach}
            className="-mx-page -mt-1.5 -mb-5 flex scroll-px-page snap-x snap-mandatory gap-card-gap overflow-x-auto overflow-y-hidden overscroll-x-contain px-page pt-1.5 pb-8 strip-fade scrollbar-visible"
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
          <Empty>Nothing needs immediate action.</Empty>
        )}
      </section>
      <section className="min-w-0" aria-labelledby="lane-all">
        <SectionHead>
          <SectionTitle id="lane-all">
            All tickets
            <SectionCount>{rows.length}</SectionCount>
          </SectionTitle>
          <SectionText>Ordered by priority, open tickets first</SectionText>
        </SectionHead>
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
  const level = levelOf(triage);

  return (
    <article
      className={cn(
        "group/card relative flex min-w-0 flex-none basis-strip-card snap-start flex-col gap-4 rounded-card border bg-surface p-5 shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-border-hover hover:shadow-float",
        "has-[[data-card-title]:focus-visible]:outline-2 has-[[data-card-title]:focus-visible]:outline-offset-2 has-[[data-card-title]:focus-visible]:outline-ring",
        // The border picks up the priority badge colour, so a card reads at a glance like its badge.
        (level === "Highest" || level === "High") && "border-danger/28 hover:border-danger/50",
        level === "Medium" && "border-warning/28 hover:border-warning/50",
      )}
    >
      <div className="flex items-center justify-between gap-2.5">
        <PriorityBadge triage={triage} />
        <StatusPill status={current.status} />
      </div>
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: id }}
        data-card-title
        className="line-clamp-2 font-display text-lg leading-snug font-medium text-pretty text-strong transition-colors duration-150 ease-soft group-hover/card:text-primary-text after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
      >
        {ticket.Summary}
      </Link>
      <Tiles className="grid-cols-2">
        <Tile>
          <TileLabel>
            <Layers size={12} strokeWidth={2} />
            Service
          </TileLabel>
          <TileValue>
            {info?.[2] === "Critical" && <Dot tone="danger" data-tip="Business-critical service" />}
            <span>{triage.service || "Unknown"}</span>
          </TileValue>
        </Tile>
        <Tile>
          <TileLabel>
            <UserRound size={12} strokeWidth={2} />
            Requested by
          </TileLabel>
          <TileValue>
            <Initials email={ticket.Reporter} small />
            <span>{personName(ticket.Reporter) || "Unknown"}</span>
          </TileValue>
        </Tile>
      </Tiles>
      {(note || age !== null) && (
        <div className="flex min-w-0 items-center gap-2 text-sm text-secondary [&_svg]:text-primary-text">
          {note && (
            <>
              {note.ai && <Sparkles size={13} strokeWidth={2} />}
              <span className="truncate">{note.text}</span>
            </>
          )}
          {age !== null && (
            <span
              className="ml-auto flex-none whitespace-nowrap text-muted tabular-nums"
              data-tip={`Opened ${ticket["Created date"]}`}
            >
              {age === 0 ? "Opened today" : `Open for ${age} day${age === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      )}
      <div className="relative z-1 mt-auto flex items-center justify-between gap-2.5">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: id }}
          className={cn(buttonVariants({ variant: "primary" }), "pr-4 pl-3 font-display text-sm")}
        >
          <ChevronsRight size={16} strokeWidth={2.25} />
          Review classification
        </Link>
        <Menu
          className="border-transparent"
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

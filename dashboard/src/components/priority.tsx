import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Hourglass,
  Inbox,
  Layers,
  LoaderCircle,
  MessageSquareReply,
  PencilLine,
  Sparkles,
  UserCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDashboard } from "../state";
import { FIELD_LABELS, STATUS_LABELS, TRIAGE_FIELDS, serviceInfo, triageLevel } from "../domain";
import {
  RECENT_LIMIT,
  ageInDays,
  arrivedAt,
  byAttention,
  byRecency,
  confirmedFields,
  lastQuestion,
  leastConfident,
  needsAttention,
  reporterReply,
  stageOf,
  timeAgo,
  timeOf,
} from "../lib/queue";
import type { Stage } from "../lib/queue";
import { Initials, PriorityBadge, opensOnClick, personName } from "./tickets";
import type { TicketRow } from "./tickets";
import { TicketTable } from "./table";
import { TicketPagination } from "./pagination";
import { Menu } from "./ui";
import { cn } from "../lib/utils";
import { Dot } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Empty } from "./ui/card";
import { SectionCount, SectionHead, SectionTitle } from "./ui/section";
import { Tile, TileLabel, TileValue, Tiles } from "./ui/tile";

/**
 * Scroll state and paging for a card strip. The strip only scrolls sideways on its own (trackpad,
 * shift+wheel, keyboard); a vertical wheel always scrolls the page, and the arrows page by the
 * cards in view for a mouse without a horizontal wheel.
 */
function useStrip(count: number, first: string | undefined) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const moved = useRef(false);

  // Cards reorder as tickets are classified, and scroll snapping would follow the card it was on.
  // Until the operator scrolls the strip, a new first card keeps it at the start.
  useLayoutEffect(() => {
    if (strip && !moved.current) strip.scrollTo({ left: 0 });
  }, [strip, first]);

  useEffect(() => {
    if (!strip) return;

    const update = () => {
      const limit = strip.scrollWidth - strip.clientWidth;

      setAtStart(strip.scrollLeft <= 1);
      setAtEnd(strip.scrollLeft >= limit - 1);
    };

    const move = () => {
      moved.current = true;
    };

    update();
    const observer = new ResizeObserver(update);
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

    observer.observe(strip);
    strip.addEventListener("scroll", update, { passive: true });

    for (const input of inputs) strip.addEventListener(input, move, { passive: true });

    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", update);

      for (const input of inputs) strip.removeEventListener(input, move);
    };
  }, [strip, count]);

  const page = (direction: 1 | -1) => {
    if (!strip) return;
    const [first, second] = strip.children;

    const card = second
      ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
      : strip.clientWidth;

    const cards = Math.max(1, Math.floor(strip.clientWidth / card));

    moved.current = true;

    strip.scrollBy({ left: direction * cards * card, behavior: "smooth" });
  };

  return { attach: setStrip, atStart, atEnd, page };
}

/** The current time, a minute at a time, so "classified 2 minutes ago" keeps counting. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
}

/** A titled row of cards that scrolls sideways when there are more than fit. */
function Lane({
  id,
  title,
  count,
  first,
  thin = false,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  // The key of the first card, so the strip can go back to it when the order changes.
  first: string | undefined;
  thin?: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  const { attach, atStart, atEnd, page } = useStrip(count, first);

  return (
    <section className="min-w-0" aria-labelledby={id}>
      <SectionHead className={cn(thin && "mb-3")}>
        <SectionTitle id={id} className={cn(thin && "text-xl")}>
          {title}
          <SectionCount>{count}</SectionCount>
        </SectionTitle>
        {count > RECENT_LIMIT && (
          <Link
            to="/tickets"
            search={{ view: "table" }}
            className="ml-auto text-sm font-medium text-secondary underline underline-offset-3 hover:text-foreground"
          >
            Browse all tickets
          </Link>
        )}
        {!(atStart && atEnd) && (
          // Touch screens swipe the card strip, so its arrows are only for a mouse.
          <span className="inline-flex gap-2 touch:hidden max-sm:hidden">
            <Button
              size="icon"
              className="bg-surface"
              aria-label={`Previous ${title.toLowerCase()} cards`}
              disabled={atStart}
              onClick={() => page(-1)}
            >
              <ChevronLeft size={16} strokeWidth={2} />
            </Button>
            <Button
              size="icon"
              className="bg-surface"
              aria-label={`Next ${title.toLowerCase()} cards`}
              disabled={atEnd}
              onClick={() => page(1)}
            >
              <ChevronRight size={16} strokeWidth={2} />
            </Button>
          </span>
        )}
      </SectionHead>
      {count > 0 ? (
        <div
          ref={attach}
          className={cn(
            "-mx-page -mt-1.5 -mb-5 flex scroll-px-page snap-x snap-mandatory gap-card-gap overflow-x-auto overflow-y-hidden overscroll-x-contain px-page pt-1.5 pb-8 strip-fade scrollbar-visible contain-paint",
            thin && "-mb-3 gap-3 pb-5",
          )}
          data-more-before={atStart ? undefined : ""}
          data-more-after={atEnd ? undefined : ""}
          role="group"
          aria-labelledby={id}
          tabIndex={0}
        >
          {children}
        </div>
      ) : (
        empty
      )}
    </section>
  );
}

/**
 * Three rows of cards, then the whole queue as a table. Upcoming holds the tickets the AI is still
 * classifying; Attention needed what to pick up next; Most recent the tickets that just became
 * available, newest first.
 */
export function PriorityView({ rows, pageRows }: { rows: TicketRow[]; pageRows: TicketRow[] }) {
  const { classifying } = useDashboard();
  const now = useNow();

  if (rows.length === 0) return <Empty>No tickets match these filters.</Empty>;

  const upcoming = rows.filter(
    (row) => row.classification === "queued" || row.classification === "classifying",
  );

  const ready = rows.filter(
    (row) => row.classification !== "queued" && row.classification !== "classifying",
  );

  const attention = ready.filter(needsAttention).sort(byAttention);
  const recent = ready.toSorted(byRecency).slice(0, RECENT_LIMIT);

  return (
    <div className="grid gap-section">
      {classifying && (
        <Lane
          id="lane-upcoming"
          title="Upcoming"
          count={upcoming.length}
          first={upcoming[0]?.id}
          thin
          empty={
            <p className="text-base text-muted">
              New Jira tickets appear here while the AI classifies them.
            </p>
          }
        >
          {upcoming.slice(0, RECENT_LIMIT).map((row) => (
            <UpcomingCard key={row.id} row={row} />
          ))}
        </Lane>
      )}
      <Lane
        id="lane-attention"
        title="Attention needed"
        count={attention.length}
        first={attention[0]?.id}
        empty={<Empty>Nothing needs your attention right now.</Empty>}
      >
        {attention.slice(0, RECENT_LIMIT).map((row) => (
          <TicketCard key={row.id} row={row} lane="attention" now={now} />
        ))}
      </Lane>
      <Lane
        id="lane-recent"
        title="Most recent"
        count={recent.length}
        first={recent[0]?.id}
        empty={<Empty>No classified tickets yet.</Empty>}
      >
        {recent.map((row) => (
          <TicketCard key={row.id} row={row} lane="recent" now={now} />
        ))}
      </Lane>
      <section className="min-w-0" aria-labelledby="lane-all">
        <SectionHead>
          <SectionTitle id="lane-all">
            All tickets
            <SectionCount>{rows.length}</SectionCount>
          </SectionTitle>
        </SectionHead>
        <TicketTable rows={pageRows} />
        <TicketPagination total={rows.length} />
      </section>
    </div>
  );
}

/** A ticket the AI has not finished: nothing to act on yet, so it is thin and not a link. */
function UpcomingCard({ row }: { row: TicketRow }) {
  const running = row.classification === "classifying";
  const state = running ? "AI is classifying" : "Waiting for the AI";

  return (
    <article
      className="flex min-w-0 flex-none basis-upcoming-card snap-start items-center gap-3 rounded-tile border border-dashed border-border-hover bg-surface py-3 pr-3.5 pl-3 loading-sweep"
      aria-busy="true"
      aria-label={`${row.id}: ${row.ticket.Summary}. ${state}.`}
    >
      {running ? (
        <LoaderCircle size={16} strokeWidth={2} className="animate-spin text-primary-text" />
      ) : (
        <Clock3 size={16} strokeWidth={2} className="text-muted" />
      )}
      <span className="grid min-w-0 flex-1 gap-0.5" aria-hidden="true">
        <span className="truncate text-base font-medium text-secondary">{row.ticket.Summary}</span>
        <span className="truncate text-sm text-muted tabular-nums">
          {row.id} · {state}
        </span>
      </span>
      {/* Where the priority will be once the AI has set it. */}
      <span className="h-5.5 w-14 flex-none rounded-pill bg-active" aria-hidden="true" />
    </article>
  );
}

// What each stage looks like and what the card's button does. Only a reply is inverted: it is new
// information to read, the loudest thing a card can carry. Blue stays the AI's colour, and red,
// yellow and green stay the priority's.
const STAGES: Record<Stage, { label: string; icon: LucideIcon; action: string; chip: string }> = {
  reply: {
    label: "Reporter replied",
    icon: MessageSquareReply,
    action: "Read the reply",
    chip: "bg-foreground text-background",
  },
  in_progress: {
    label: "Triage started",
    icon: PencilLine,
    action: "Continue triage",
    chip: "bg-active text-foreground",
  },
  review: {
    label: "AI classified",
    icon: Sparkles,
    action: "Review classification",
    chip: "bg-primary-subtle text-primary-text",
  },
  unclassified: {
    label: "Awaiting review",
    icon: Inbox,
    action: "Classify ticket",
    chip: "border border-dashed border-border-hover text-secondary",
  },
  assigned: {
    label: "Assigned",
    icon: UserCheck,
    action: "Open ticket",
    chip: "border text-secondary [&_svg]:text-info",
  },
  waiting: {
    label: STATUS_LABELS.waiting,
    icon: Hourglass,
    action: "Open ticket",
    chip: "border text-secondary [&_svg]:text-warning",
  },
  resolved: {
    label: "Resolved",
    icon: CircleCheck,
    action: "Open ticket",
    chip: "border text-muted [&_svg]:text-success",
  },
};

// Stages that are the operator's turn: the priority colours the card and the button is primary.
const ACTIONABLE: readonly Stage[] = ["reply", "in_progress", "review", "unclassified"];

// A classification from the last quarter of an hour is marked, so a ticket you wait for stands out.
const FRESH = 15 * 60 * 1000;

type LaneKind = "attention" | "recent";

function TicketCard({ row, lane, now }: { row: TicketRow; lane: LaneKind; now: number }) {
  const { assign } = useDashboard();
  const navigate = useNavigate();
  const { ticket, current, id, index } = row;
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "the service team";
  const level = triageLevel(triage);
  const stage = stageOf(row);
  const failed = row.classification === "failed";
  const actionable = ACTIONABLE.includes(stage);
  const look = STAGES[stage];
  const Icon = failed ? CircleAlert : look.icon;

  return (
    <article
      className={cn(
        "group/card flex min-w-0 flex-none basis-strip-card cursor-pointer snap-start flex-col gap-4 rounded-card border bg-surface p-5 shadow-card transition-card duration-150 hover:-translate-y-0.5 hover:border-border-hover",
        "has-[[data-card-title]:focus-visible]:outline-2 has-[[data-card-title]:focus-visible]:outline-offset-2 has-[[data-card-title]:focus-visible]:outline-ring",
        // A simulated ticket the AI just classified joins its rows.
        row.arrival === "classified" && "animate-arrive",
        // The border picks up the priority badge colour, so a card reads at a glance like its badge.
        actionable &&
          (level === "Highest" || level === "High") &&
          "border-danger/28 hover:border-danger/50",
        actionable && level === "Medium" && "border-warning/28 hover:border-warning/50",
        // Dashed, as everywhere a value is missing: there is no AI suggestion to review.
        failed && "border-dashed",
      )}
      // The whole card opens the ticket, but its badges keep their tooltips and the text stays selectable.
      onClick={(event) => {
        if (opensOnClick(event))
          void navigate({ to: "/tickets/$ticketId", params: { ticketId: id } });
      }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span
          className={cn(
            "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-pill px-2.5 text-sm font-medium whitespace-nowrap [&_svg]:size-3.5",
            look.chip,
          )}
        >
          <Icon strokeWidth={2} />
          <span className="truncate">{failed ? "AI couldn't classify" : look.label}</span>
        </span>
        <PriorityBadge triage={triage} />
      </div>
      <div className="grid gap-1">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: id }}
          data-card-title
          className={cn(
            "line-clamp-2 font-display text-lg leading-snug font-medium text-pretty text-strong transition-colors duration-150 ease-soft group-hover/card:text-primary-text focus-visible:outline-none",
            !actionable && "text-foreground",
          )}
        >
          {ticket.Summary}
        </Link>
        <CardMeta row={row} lane={lane} now={now} />
      </div>
      <Tiles className="grid-cols-2 max-sm:grid-cols-1">
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
      <StageDetail row={row} stage={stage} team={team} />
      <div className="mt-auto flex items-center justify-between gap-2.5">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: id }}
          className={cn(
            buttonVariants({ variant: actionable ? "primary" : "default" }),
            "pr-4 pl-3 font-display text-sm",
          )}
        >
          <ChevronsRight size={16} strokeWidth={2.25} />
          {failed ? "Classify manually" : look.action}
        </Link>
        <Menu
          className="border-transparent"
          label={`More actions for ${id}`}
          items={[
            ...(actionable
              ? [
                  {
                    label: `Assign to ${team}${triage.assignee ? ` · ${personName(triage.assignee)}` : ""}`,
                    onSelect: () => assign(index),
                  },
                ]
              : []),
            {
              label: `Copy ticket key ${id}`,
              onSelect: () => void navigator.clipboard.writeText(id),
            },
          ]}
        />
      </div>
    </article>
  );
}

/** The ticket key and the one time that matters in this row: how long it waits, or how new it is. */
function CardMeta({ row, lane, now }: { row: TicketRow; lane: LaneKind; now: number }) {
  const created = row.ticket["Created date"];
  const classified = timeOf(row.proposal?.classified_at);
  let time: ReactNode = null;

  if (lane === "recent" && classified !== null) {
    const fresh = now - classified < FRESH;

    time = (
      <span
        className={cn("inline-flex items-center gap-1.5", fresh && "text-primary-text")}
        data-tip={`Classified ${new Date(classified).toLocaleString()}`}
      >
        {fresh && <Dot tone="primary" />}
        Classified {timeAgo(classified, now)}
      </span>
    );
  } else if (lane === "recent") {
    const opened = arrivedAt(row);

    time =
      opened === null ? null : (
        <span data-tip={`Opened ${created}`}>Opened {timeAgo(opened, now)}</span>
      );
  } else {
    const age = ageInDays(row, now);

    time =
      age === null ? null : (
        <span data-tip={`Opened ${created}`}>
          {age === 0 ? "Opened today" : `Open for ${age} day${age === 1 ? "" : "s"}`}
        </span>
      );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted tabular-nums">
      <span>{row.id}</span>
      {time && (
        <>
          <span aria-hidden="true">·</span>
          {time}
        </>
      )}
    </span>
  );
}

/** The one thing worth knowing about a ticket in this stage before opening it. */
function StageDetail({ row, stage, team }: { row: TicketRow; stage: Stage; team: string }) {
  const { ticket, proposal, current } = row;

  if (stage === "reply")
    return (
      <blockquote className="line-clamp-3 border-l-2 border-foreground/40 pl-3 text-base leading-relaxed text-foreground">
        “{reporterReply(ticket)}”
      </blockquote>
    );

  if (stage === "waiting") {
    const question = lastQuestion(ticket);

    return question ? (
      <p className="line-clamp-2 text-sm leading-relaxed text-secondary">
        <span className="text-muted">You asked: </span>
        {question}
      </p>
    ) : null;
  }

  if (stage === "assigned")
    return (
      <p className="flex min-w-0 items-center gap-2 text-sm text-secondary">
        <Initials email={current.triage.assignee || null} small />
        <span className="truncate">
          {current.triage.assignee ? personName(current.triage.assignee) : "Unassigned"} · {team}
        </span>
      </p>
    );

  if (stage === "resolved") return null;

  if (row.classification === "failed")
    return <Note>Showing the values the reporter declared.</Note>;

  const confirmed = confirmedFields(row);

  if (stage === "in_progress" && confirmed > 0)
    return (
      <div className="grid gap-2">
        <span className="flex gap-1" aria-hidden="true">
          {TRIAGE_FIELDS.map((field, position) => (
            <i
              key={field}
              className={cn(
                "h-1 flex-1 rounded-pill bg-active",
                position < confirmed && "bg-foreground",
              )}
            />
          ))}
        </span>
        <span className="text-sm text-secondary tabular-nums">
          {confirmed} of {TRIAGE_FIELDS.length} fields confirmed
        </span>
      </div>
    );

  if (!proposal) return current.triage.assignee ? null : <Note>No assignee yet</Note>;
  const declaredService = ticket["Affected Business or IT Services"][0];
  const declaredWork = ticket["Work type"];
  const unsure = leastConfident(proposal);

  if (proposal.proposal.service !== declaredService)
    return <Note ai>AI moved it from {declaredService || "no service"}</Note>;

  if (proposal.proposal.work_type !== declaredWork)
    return <Note ai>AI changed it from {declaredWork}</Note>;

  if (unsure) return <Note ai>AI is unsure about the {FIELD_LABELS[unsure].toLowerCase()}</Note>;

  if (proposal.core?.lane === "human_only") return <Note ai>AI left this one to you</Note>;

  return current.triage.assignee ? null : <Note>No assignee yet</Note>;
}

function Note({ ai = false, children }: { ai?: boolean; children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm text-secondary [&_svg]:text-primary-text">
      {ai && <Sparkles size={13} strokeWidth={2} />}
      <span className="truncate">{children}</span>
    </p>
  );
}

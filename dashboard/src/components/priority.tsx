import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import {
  LEVELS,
  PRIORITY_DOTS,
  STATUS_DOTS,
  STATUS_LABELS,
  priority,
  serviceInfo,
} from "../domain";
import { Initials, personName } from "./tickets";
import type { TicketRow } from "./tickets";

type Lane = "action" | "review" | "next" | "others";

const LANES: { lane: Lane; title: string; help: string; dot: string }[] = [
  {
    lane: "action",
    title: "Action required",
    help: "High priority or a critical service, not yet routed",
    dot: "red",
  },
  {
    lane: "review",
    title: "Check the AI changes",
    help: "The AI changed what the reporter declared, or found no assignee",
    dot: "amber",
  },
  { lane: "next", title: "Up next", help: "Nothing unusual, most important first", dot: "" },
  {
    lane: "others",
    title: "Waiting on others",
    help: "With the service team or the reporter",
    dot: "cyan",
  },
];

interface Scored {
  row: TicketRow;
  lane: Lane;
  // The one thing worth knowing before opening the ticket, if anything.
  note: { text: string; ai: boolean } | null;
  age: number | null;
  // Lower is more important: priority first, then critical services, then the oldest ticket.
  rank: [number, number, number];
}

const DAY = 24 * 60 * 60 * 1000;

/** Whole days since the ticket was created; the export uses "YYYY-MM-DD HH:mm" in local time. */
function ageInDays(created: string) {
  const time = new Date(created.replace(" ", "T")).getTime();

  return Number.isNaN(time) ? null : Math.max(0, Math.floor((Date.now() - time) / DAY));
}

function score(row: TicketRow): Scored | null {
  const { status, triage } = row.current;

  if (status === "resolved") return null;
  const level = priority(triage.urgency, triage.impact);
  const critical = serviceInfo(triage.service)?.[2] === "Critical";
  const age = ageInDays(row.ticket["Created date"]);
  const declaredService = row.ticket["Affected Business or IT Services"][0];
  const declaredWork = row.ticket["Work type"];
  const serviceChanged = row.proposal !== null && row.proposal.proposal.service !== declaredService;
  const workChanged = row.proposal !== null && row.proposal.proposal.work_type !== declaredWork;
  const urgent = level === "Highest" || level === "High" || (critical && level === "Medium");

  let lane: Lane = "next";

  if (status === "assigned" || status === "waiting") lane = "others";
  else if (urgent) lane = "action";
  else if (serviceChanged || workChanged || !triage.assignee) lane = "review";

  let note: Scored["note"] = null;

  if (lane === "others") note = { text: STATUS_LABELS[status], ai: false };
  else if (serviceChanged) note = { text: `AI moved it from ${declaredService}`, ai: true };
  else if (workChanged) note = { text: `AI changed it from ${declaredWork}`, ai: true };
  else if (!triage.assignee) note = { text: "No assignee yet", ai: false };
  else if (status === "in_progress") note = { text: STATUS_LABELS[status], ai: false };

  return { row, lane, note, age, rank: [LEVELS.indexOf(level), critical ? 0 : 1, -(age ?? 0)] };
}

function byRank(a: Scored, b: Scored) {
  return a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2];
}

/** Open tickets grouped by how soon an operator has to act on them, most important first. */
export function PriorityView({ rows }: { rows: TicketRow[] }) {
  const scored = rows.flatMap((row) => score(row) ?? []);
  const resolved = rows.length - scored.length;

  if (scored.length === 0)
    return (
      <section className="card">
        <div className="empty">
          {rows.length === 0 ? "No tickets match these filters." : "Nothing left to act on."}
        </div>
      </section>
    );

  return (
    <div className="priority-view">
      {LANES.map(({ lane, title, help, dot }) => {
        const cards = scored.filter((item) => item.lane === lane).sort(byRank);

        if (cards.length === 0) return null;

        return (
          <section key={lane} className="priority-lane" aria-labelledby={`lane-${lane}`}>
            <header>
              <h2 id={`lane-${lane}`}>
                <i className={`dot ${dot}`} />
                {title}
                <span className="num">{cards.length}</span>
              </h2>
              <p>{help}</p>
            </header>
            <div className="priority-grid">
              {cards.map((item) => (
                <PriorityCard key={item.row.id} item={item} />
              ))}
            </div>
          </section>
        );
      })}
      {resolved > 0 && (
        <p className="priority-foot num">
          {resolved} resolved {resolved === 1 ? "ticket is" : "tickets are"} not shown.
        </p>
      )}
    </div>
  );
}

function PriorityCard({ item }: { item: Scored }) {
  const { row, note, age, lane } = item;
  const { ticket, current, id } = row;
  const { triage } = current;
  const level = priority(triage.urgency, triage.impact);

  return (
    <Link to="/tickets/$ticketId" params={{ ticketId: id }} className="priority-card">
      <span className="priority-card-head">
        <span
          className={level === "Highest" || level === "High" ? "level strong" : "level"}
          data-tip={`Urgency ${triage.urgency} × Impact ${triage.impact}`}
        >
          <i className={`dot ${PRIORITY_DOTS[level]}`} />
          {level}
        </span>
        <span className="ticket-id">{id}</span>
        {age !== null && (
          <span className="age num" data-tip={`Opened ${ticket["Created date"]}`}>
            {age === 0 ? "today" : `${age}d`}
          </span>
        )}
      </span>
      <b>{ticket.Summary}</b>
      {note && (
        <span className={note.ai ? "priority-note ai" : "priority-note"}>
          {note.ai ? (
            <Sparkles size={12} strokeWidth={1.75} />
          ) : (
            lane === "others" && <i className={`dot ${STATUS_DOTS[current.status]}`} />
          )}
          {note.text}
        </span>
      )}
      <span className="priority-card-foot">
        <span className="service">{triage.service}</span>
        <span data-tip={triage.assignee ? personName(triage.assignee) : "Unassigned"}>
          <Initials email={triage.assignee} />
        </span>
      </span>
    </Link>
  );
}

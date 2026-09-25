import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Info,
  MessageCircleQuestion,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import type { Verifiable } from "../state";
import { OUTCOME_LABELS, serviceInfo } from "../domain";
import type { Ticket } from "../domain";
import {
  CriticalBadge,
  Initials,
  PriorityBadge,
  StatusPill,
  personName,
  useTicketRows,
} from "../components/tickets";
import {
  ClassificationSidebar,
  KindIcon,
  Reason,
  ReasonTooltip,
} from "../components/classification";
import type { TagKind } from "../components/classification";
import { CommentEditor, Dialog, Fold, OutcomePicker, SubmitHint } from "../components/ui";
import { Button, buttonVariants, linkButtonClass } from "../components/ui/button";
import { Card, CardSection, CardTitle, Empty } from "../components/ui/card";
import { Kbd } from "../components/ui/form";
import { Tile, TileLabel, Tiles, TileValue } from "../components/ui/tile";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketWorkspace });

type Step = "resolve" | "ask" | "assign";

/* The reply starts as the model's draft and stays flagged until the operator approves or edits it. */
const DRAFT_FLAGS: Record<TagKind, string> = {
  ai: "AI draft · not reviewed yet",
  verified: "Approved by you",
  human: "Edited by you",
  declared: "",
  derived: "",
};

function draftKind(reply: string, draft: string, verified: readonly Verifiable[]): TagKind {
  if (reply.trim() !== draft.trim()) return "human";

  return verified.includes("reply") ? "verified" : "ai";
}

// Historical fixes are offered only when they match the request at least this closely.
const REFERENCE_SIMILARITY = 0.1;

// Descriptions longer than this open folded to a few lines.
const LONG_DESCRIPTION = 420;

const descriptionClass = "text-md leading-relaxed whitespace-pre-line text-pretty text-secondary";

const stepActionsClass = "flex items-center justify-end gap-3 border-t border-divider pt-4";

const formatDate = (value: string | null) =>
  value === null
    ? ""
    : new Date(value.replace(" ", "T")).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

function TicketWorkspace() {
  const { ticketId } = Route.useParams();
  const { data, idOf } = useDashboard();
  const index = data.challenge.findIndex((_, position) => idOf(position) === ticketId);

  if (index < 0)
    return (
      <Empty>
        Ticket not found.{" "}
        <Link to="/tickets" className="text-foreground underline underline-offset-3">
          Back to tickets
        </Link>
      </Empty>
    );

  return (
    <div className="mx-auto grid max-w-360 grid-cols-workspace items-start gap-7 max-xl:grid-cols-workspace-compact max-lg:grid-cols-1">
      <QueueNav ticketId={ticketId} index={index} />
      <TicketDetail key={ticketId} ticketId={ticketId} index={index} />
      <ClassificationSidebar key={`classify-${ticketId}`} index={index} />
    </div>
  );
}

/** Previous and next walk the queue as it is filtered on the list page; J and K do the same. */
function QueueNav({ ticketId, index }: { ticketId: string; index: number }) {
  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
  const order = visible.some((row) => row.index === index) ? visible : rows;
  const position = order.findIndex((row) => row.index === index);
  const previousId = order[position - 1]?.id;
  const nextId = order[position + 1]?.id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, [role=listbox], [aria-haspopup=listbox], [aria-modal=true]",
        )
      )
        return;

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.key === "j" ? nextId : event.key === "k" ? previousId : undefined;

      if (target) void navigate({ to: "/tickets/$ticketId", params: { ticketId: target } });
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, nextId, previousId]);

  return (
    <nav className="col-span-full mt-2 mb-1 flex items-center gap-3" aria-label="Queue">
      <Link
        to="/tickets"
        className={cn(buttonVariants({ variant: "ghost" }), "h-6 gap-1.75 px-2.5 text-sm")}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        All tickets
      </Link>
      <span className="text-sm text-muted tabular-nums">
        {position + 1} of {order.length}
      </span>
      <span className="ml-auto" />
      <span
        className="inline-flex gap-0.75 max-md:hidden touch:hidden"
        data-tip="Keyboard: K previous, J next"
      >
        <Kbd>K</Kbd>
        <Kbd>J</Kbd>
      </span>
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: previousId ?? ticketId }}
        className={cn(buttonVariants({ size: "icon" }), "bg-surface")}
        aria-label="Previous ticket"
        disabled={!previousId}
      >
        <ChevronLeft size={16} strokeWidth={1.75} />
      </Link>
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: nextId ?? ticketId }}
        className={cn(buttonVariants({ size: "icon" }), "bg-surface")}
        aria-label="Next ticket"
        disabled={!nextId}
      >
        <ChevronRight size={16} strokeWidth={1.75} />
      </Link>
    </nav>
  );
}

function Comments({ comments }: { comments: string[] }) {
  return (
    <div className="grid">
      {comments.map((comment, place) => {
        const [author, ...rest] = comment.split(":");

        return (
          <div key={place} className="border-t border-divider py-3 first:border-t-0 first:pt-0">
            <b className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Initials email={author} small />
              {personName(author)}
            </b>
            <p className="mt-1.5 leading-comment text-secondary">{rest.join(":").trim()}</p>
          </div>
        );
      })}
    </div>
  );
}

function TicketDetail({ ticketId, index }: { ticketId: string; index: number }) {
  const { data, review, proposalFor, update, verify, assign, resolve, askReporter, move, signIn } =
    useDashboard();

  const current = review(index);
  const proposal = proposalFor(index);

  const [step, setStep] = useState<Step>(() =>
    current.status === "waiting" ||
    (current.status === "new" && proposal?.proposal.resolution === "clarification")
      ? "ask"
      : "resolve",
  );

  const [historical, setHistorical] = useState<Ticket | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ticket = data.challenge[index];
  const { triage } = current;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "Unknown team";
  const aiDraft = proposal?.proposal.resolution_comment ?? "";
  const draft = aiDraft ? draftKind(current.reply, aiDraft, current.verified ?? []) : null;
  const longDescription = ticket.Description.length > LONG_DESCRIPTION;

  const references = (data.similar[ticketId] ?? []).filter(
    (item) => item.service === triage.service && item.similarity >= REFERENCE_SIMILARITY,
  );

  const closed = current.status === "resolved";
  const decided = current.status !== "new" && current.status !== "in_progress";
  const canResolve = Boolean(triage.assignee) && current.reply.trim().length > 0;
  const canAsk = Boolean(triage.assignee) && current.question.trim().length > 0;

  const choices: { value: Step; title: string; help: string; icon: typeof Send }[] = [
    {
      value: "resolve",
      title: "Resolve",
      help: "Close it and post a note to the reporter",
      icon: CircleCheck,
    },
    {
      value: "ask",
      title: "Ask the reporter",
      help: `Send ${personName(ticket.Reporter)} a question and wait`,
      icon: MessageCircleQuestion,
    },
    {
      value: "assign",
      title: "Assign to team",
      help: `Route it to ${team} to work on`,
      icon: Users,
    },
  ];

  return (
    <div className="grid min-w-0 gap-5">
      <header className="grid gap-3 pt-1 pb-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <PriorityBadge triage={triage} />
          {info?.[2] === "Critical" && <CriticalBadge />}
          <StatusPill status={current.status} />
          <span className="text-base font-medium whitespace-nowrap text-muted tabular-nums">
            {ticketId} · {ticket["Request type"] ?? ticket["Work type"]}
          </span>
        </div>
        <h1 className="font-display text-4xl leading-heading font-semibold tracking-snug text-pretty max-sm:text-2xl">
          {ticket.Summary}
        </h1>
        <Tiles className="grid-cols-tiles-wide">
          <Tile>
            <TileLabel>
              <UserRound size={12} strokeWidth={2} />
              Requested by
            </TileLabel>
            <TileValue data-tip={ticket.Reporter ?? undefined}>
              <Initials email={ticket.Reporter} small />
              <span>{personName(ticket.Reporter) || "Unknown"}</span>
            </TileValue>
          </Tile>
          <Tile>
            <TileLabel>
              <CalendarClock size={12} strokeWidth={2} />
              Opened
            </TileLabel>
            <TileValue>
              <span>{formatDate(ticket["Created date"]) || "Unknown"}</span>
            </TileValue>
          </Tile>
          <Tile>
            <TileLabel>
              <Building2 size={12} strokeWidth={2} />
              Entity
            </TileLabel>
            <TileValue>
              <span>{ticket["Business Entity"].join(", ") || "None"}</span>
            </TileValue>
          </Tile>
          {ticket["Due date"] && (
            <Tile>
              <TileLabel>
                <CalendarClock size={12} strokeWidth={2} />
                Due
              </TileLabel>
              <TileValue>
                <span>{formatDate(ticket["Due date"])}</span>
              </TileValue>
            </Tile>
          )}
        </Tiles>
      </header>

      <Card className="p-0" aria-label="Request">
        <div className="grid gap-4.5 p-card-pad">
          <p className={cn(descriptionClass, longDescription && !expanded && "line-clamp-6")}>
            {ticket.Description}
          </p>
          {longDescription && (
            <div>
              <button className={linkButtonClass} onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show less" : "Read the full request"}
              </button>
            </div>
          )}
        </div>
        <Fold
          icon={<MessageSquare size={16} strokeWidth={1.75} />}
          title="Comments"
          count={ticket["All Comments"].length}
        >
          {ticket["All Comments"].length ? (
            <Comments comments={ticket["All Comments"]} />
          ) : (
            <p className="text-muted">No comments yet.</p>
          )}
        </Fold>
        <Fold icon={<Info size={16} strokeWidth={1.75} />} title="Jira details">
          <dl className="grid gap-2.5 [&>div]:grid [&>div]:grid-cols-details [&>div]:gap-3 max-sm:[&>div]:grid-cols-1 max-sm:[&>div]:gap-0.5 [&_dd]:wrap-anywhere [&_dt]:text-muted">
            <div>
              <dt>Reporter</dt>
              <dd>{ticket.Reporter}</dd>
            </div>
            <div>
              <dt>Linked issues</dt>
              <dd>{ticket["Linked issues"].join(", ") || "None"}</dd>
            </div>
            <div>
              <dt>Declared priority</dt>
              <dd>
                {ticket.Priority ?? "None"} (Urgency {ticket.Urgency ?? "unknown"} × Impact{" "}
                {ticket.Impact ?? "unknown"})
              </dd>
            </div>
            <div>
              <dt>Declared service</dt>
              <dd>{ticket["Affected Business or IT Services"].join(", ") || "None"}</dd>
            </div>
          </dl>
        </Fold>
      </Card>

      <Card className="p-0" aria-label="Next step">
        <div className="flex items-center gap-3.5 border-b border-divider px-card-pad py-4.5">
          <span
            className={cn(
              "grid size-7 flex-none place-items-center rounded-full bg-primary-subtle font-display text-sm font-semibold text-primary-text",
              decided && "bg-success/15 text-success",
            )}
          >
            {decided ? <Check size={14} strokeWidth={2.5} /> : "2"}
          </span>
          <div>
            <CardTitle className="text-lg">Decide the next step</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              {signIn?.user
                ? `Comments are posted to Jira by ${signIn.user.name}.`
                : `Comments are posted to Jira as ${personName(triage.assignee) || "the assignee"}.`}
            </p>
          </div>
        </div>
        <div className="grid gap-4.5 p-card-pad">
          {decided && (
            <div className="flex items-center gap-2.5 rounded-tile border border-success/30 bg-success/7 py-2.5 pr-2.5 pl-3.5 text-foreground [&_svg]:text-success">
              <CircleCheck size={16} strokeWidth={1.75} />
              <span>
                {current.status === "resolved"
                  ? `Resolved as “${OUTCOME_LABELS[current.outcome]}”.`
                  : current.status === "waiting"
                    ? `Waiting for ${personName(ticket.Reporter)} to answer.`
                    : `Assigned to ${team}${triage.assignee ? ` · ${personName(triage.assignee)}` : ""}.`}
              </span>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => move(index, "in_progress")}
              >
                <RotateCcw size={14} strokeWidth={1.75} />
                Reopen
              </Button>
            </div>
          )}

          {!closed && (
            <>
              <div
                className="grid grid-cols-3 gap-2.5 max-md:grid-cols-1"
                role="radiogroup"
                aria-label="Next step"
              >
                {choices.map(({ value, title, help, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    className="group/choice grid gap-1.5 rounded-tile border bg-elevated p-3.5 text-left text-secondary transition duration-150 ease-soft hover:border-border-hover hover:bg-elevated-hover hover:text-foreground active:scale-99 aria-checked:border-primary aria-checked:bg-primary-subtle aria-checked:text-secondary"
                    aria-checked={step === value}
                    onClick={() => setStep(value)}
                  >
                    <b className="flex items-center gap-2 font-display text-base font-semibold text-foreground group-aria-checked/choice:text-primary-text">
                      <Icon size={16} strokeWidth={1.75} />
                      {title}
                    </b>
                    <small className="text-sm leading-choice">{help}</small>
                    {value === "ask" && proposal?.proposal.resolution === "clarification" && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text">
                        <Sparkles size={11} strokeWidth={2} />
                        AI recommends this
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {step === "resolve" && (
                <>
                  <OutcomePicker
                    value={current.outcome}
                    onChange={(outcome) => update(index, { outcome })}
                  />
                  <CommentEditor
                    author={triage.assignee}
                    label="Resolution note"
                    placeholder="What was done, and how the reporter can confirm it is fixed."
                    value={current.reply}
                    onChange={(reply) => update(index, { reply })}
                    draft={draft === "ai"}
                    onSubmit={canResolve ? () => resolve(index) : undefined}
                  />
                  {draft && proposal && (
                    <div className="-mt-1.5 flex flex-wrap items-center gap-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-sm font-medium text-secondary",
                          draft === "ai" && "text-accent",
                          draft === "verified" && "text-success",
                        )}
                      >
                        <KindIcon kind={draft} />
                        {DRAFT_FLAGS[draft]}
                      </span>
                      <ReasonTooltip
                        side="top"
                        align="start"
                        trigger={
                          <button className={linkButtonClass}>
                            <Info size={14} strokeWidth={1.75} />
                            Why this draft
                          </button>
                        }
                      >
                        <Reason
                          title="Why this draft"
                          explanation={
                            proposal.explanations?.resolution_comment ?? {
                              reason:
                                proposal.rationale ||
                                "The model gave no reason for this suggestion.",
                              confidence: null,
                              evidence: [
                                `Suggested outcome: ${OUTCOME_LABELS[current.outcome]}`,
                                "Written for the assignee to post once the fix is confirmed",
                              ],
                            }
                          }
                          modelId={proposal.model_id}
                          footer="Edit the note or approve it as is"
                        />
                      </ReasonTooltip>
                      <span className="ml-auto">
                        {draft === "ai" && (
                          <Button onClick={() => verify(index, ["reply"], true)}>
                            <Check size={16} strokeWidth={2} />
                            Approve draft
                          </Button>
                        )}
                        {draft === "verified" && (
                          <Button variant="ghost" onClick={() => verify(index, ["reply"], false)}>
                            Undo approval
                          </Button>
                        )}
                        {draft === "human" && (
                          <Button variant="ghost" onClick={() => update(index, { reply: aiDraft })}>
                            <Undo2 size={16} strokeWidth={1.75} />
                            Restore AI draft
                          </Button>
                        )}
                      </span>
                    </div>
                  )}
                  {references.length > 0 && (
                    <Fold
                      layout="framed"
                      icon={<BookOpen size={16} strokeWidth={1.75} />}
                      title="Fixes from similar resolved tickets"
                      count={Math.min(references.length, 3)}
                    >
                      <div className="grid gap-2">
                        {references.slice(0, 3).map((item) => (
                          <article
                            key={item.historical_index}
                            className="rounded-tile border bg-elevated px-3.5 py-3"
                          >
                            <p className="leading-comment text-foreground">
                              {item.resolution_text}
                            </p>
                            <footer className="mt-2.5 flex flex-wrap items-center gap-3 text-sm">
                              <span className="text-muted">
                                Used on {item.times_used} resolved {triage.service} ticket
                                {item.times_used === 1 ? "" : "s"}
                              </span>
                              <button
                                className={linkButtonClass}
                                onClick={() =>
                                  setHistorical(
                                    data.historical_examples[String(item.historical_index)],
                                  )
                                }
                              >
                                View ticket
                              </button>
                              <Button
                                size="sm"
                                className="ml-auto"
                                onClick={() => update(index, { reply: item.resolution_text })}
                              >
                                Use as note
                              </Button>
                            </footer>
                          </article>
                        ))}
                      </div>
                    </Fold>
                  )}
                  <div className={stepActionsClass}>
                    {!triage.assignee && (
                      <span className="mr-auto text-sm text-muted">Choose an assignee first.</span>
                    )}
                    <SubmitHint />
                    <Button
                      variant="primary"
                      size="large"
                      disabled={!canResolve}
                      onClick={() => resolve(index)}
                    >
                      <CircleCheck size={16} strokeWidth={2} />
                      Resolve ticket
                    </Button>
                  </div>
                </>
              )}

              {step === "ask" && (
                <>
                  <CommentEditor
                    author={triage.assignee}
                    label="Question"
                    placeholder="What information do you need to continue?"
                    rows={4}
                    value={current.question}
                    onChange={(question) => update(index, { question })}
                    onSubmit={canAsk ? () => askReporter(index) : undefined}
                  />
                  <div className={stepActionsClass}>
                    {!triage.assignee && (
                      <span className="mr-auto text-sm text-muted">Choose an assignee first.</span>
                    )}
                    <SubmitHint />
                    <Button
                      variant="primary"
                      size="large"
                      disabled={!canAsk}
                      onClick={() => askReporter(index)}
                    >
                      <Send size={16} strokeWidth={2} />
                      Send question
                    </Button>
                  </div>
                </>
              )}

              {step === "assign" && (
                <>
                  <p className={descriptionClass}>
                    Routes the ticket to <b>{team}</b>
                    {triage.assignee ? (
                      <>
                        {" "}
                        and assigns it to <b>{personName(triage.assignee)}</b>
                      </>
                    ) : (
                      " without a named assignee"
                    )}
                    . The ticket stays open for the team to work on.
                  </p>
                  <div className={stepActionsClass}>
                    <Button
                      variant="primary"
                      size="large"
                      disabled={current.status === "assigned"}
                      onClick={() => assign(index)}
                    >
                      <Users size={16} strokeWidth={2} />
                      Assign ticket
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Card>

      {historical && (
        <Dialog
          title={historical.Summary}
          description={`${historical["Affected Business or IT Services"].join(", ")} · resolved ${historical["Resolution date"] ? formatDate(historical["Resolution date"]) : ""}`}
          onClose={() => setHistorical(null)}
          footer={
            <Button onClick={() => setHistorical(null)}>
              <X size={16} strokeWidth={1.75} />
              Close
            </Button>
          }
        >
          <p className={descriptionClass}>{historical.Description}</p>
          <CardSection>Comments</CardSection>
          <Comments comments={historical["All Comments"]} />
        </Dialog>
      )}
    </div>
  );
}

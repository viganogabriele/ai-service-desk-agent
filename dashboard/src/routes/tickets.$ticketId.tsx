import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  History,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useDashboard } from "../state";
import {
  ESCALATION_REASONS,
  IMPACT_LABELS,
  LEVELS,
  PRIORITY_MATRIX,
  RESOLUTIONS,
  SERVICES,
  STATUS_LABELS,
  URGENCY_LABELS,
  commentBody,
  confidenceLabel,
  formChanges,
  priority,
  reviewWarnings,
  serviceInfo,
  startingForm,
} from "../domain";
import type { FormValues, Ticket } from "../domain";
import {
  BoardEmpty,
  PriorityPill,
  SearchField,
  StatusPill,
  StatusSelect,
  isOpen,
  useTicketRows,
} from "../components/tickets";
import { Button, buttonVariants } from "../components/ui/button";
import { Dot, MockBadge, Pill, Tag } from "../components/ui/badge";
import { Card, CardDescription, CardHeader, CardSection, CardTitle } from "../components/ui/card";
import { ChangeArrow, OldValue } from "../components/ui/change";
import { Chip } from "../components/ui/chip";
import { Field, FieldGroup, ReadonlyValue, Select, Textarea } from "../components/ui/field";
import { Grid, SPAN, Stack } from "../components/ui/grid";
import { Kbd } from "../components/ui/kbd";
import { Meter } from "../components/ui/meter";
import { Eyebrow, PageTitle } from "../components/ui/page";
import { Segmented, SegmentedItem } from "../components/ui/segmented";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketWorkspace });

type Panel = "escalate" | "clarify" | "premium" | null;

const panelToggle = "aria-expanded:border-ring";

const panelCard = "mb-4 border-ring";

const panelActions = "mt-3.5 flex justify-end";

const originalFields = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2";

const commentRow = "border-t border-divider py-3";

const similarIcon = "text-muted group-hover:text-foreground";

const timelineText = "text-sm text-secondary";

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="icon" aria-label="Close" onClick={onClick}>
      <X size={16} strokeWidth={1.75} />
    </Button>
  );
}

function OriginalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      <strong className="text-base font-medium wrap-anywhere text-foreground">
        {value || "Not provided"}
      </strong>
    </div>
  );
}

function Diff({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <p className="grid min-h-9 grid-cols-diff items-center border-t border-divider py-2 text-foreground">
      <span className="text-sm text-muted">{label}</span>
      <span>
        {before === after ? <span>{before}</span> : <OldValue>{before}</OldValue>}
        <ChangeArrow />
        {after}
      </span>
    </p>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const ACTION_LABELS = new Map([
  ["accept", "Accepted proposal"],
  ["modify", "Modified & accepted"],
  ["escalate", "Escalated"],
  ["clarify", "Requested clarification"],
  ["regenerate", "Regenerated with premium model"],
  ["undo", "Undid last action"],
]);

function TicketWorkspace() {
  const { ticketId } = Route.useParams();

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-workspace-compact xl:grid-cols-workspace">
      <QueueRail ticketId={ticketId} />
      <TicketDetail key={ticketId} ticketId={ticketId} />
    </div>
  );
}

function QueueRail({ ticketId }: { ticketId: string }) {
  const { visible } = useTicketRows();

  return (
    <aside
      className="static flex max-h-70 flex-col rounded-card border bg-surface lg:sticky lg:top-4 lg:max-h-rail"
      aria-label="Ticket queue"
    >
      <div className="grid gap-2 border-b border-divider p-2.5">
        <Link
          to="/tickets"
          className={cn(buttonVariants({ variant: "ghost" }), "justify-start px-2")}
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          All tickets
        </Link>
        <SearchField compact />
        <StatusSelect />
      </div>
      <div className="grid content-start gap-0.5 overflow-y-auto p-1.5">
        {visible.map((row) => (
          <Link
            key={row.proposal.ticket_id}
            to="/tickets/$ticketId"
            params={{ ticketId: row.proposal.ticket_id }}
            className={cn(
              "grid gap-0.75 rounded-control px-2.5 py-2",
              row.proposal.ticket_id === ticketId
                ? "bg-active shadow-rail-active"
                : "hover:bg-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted tabular-nums">
                {row.proposal.ticket_id}
              </span>
              <StatusPill status={row.current.status} className="h-5 text-xs" />
            </span>
            <b className="truncate font-medium">{row.ticket.Summary}</b>
            <small className="truncate text-sm text-muted">
              {row.current.form.service} ·{" "}
              {priority(row.current.form.urgency, row.current.form.impact)}
            </small>
          </Link>
        ))}
        {visible.length === 0 && <BoardEmpty>No tickets match.</BoardEmpty>}
      </div>
    </aside>
  );
}

function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data, review, proposalFor, history, actions, edit, act, regenerate, undo, premium } =
    useDashboard();

  const navigate = useNavigate();
  const { rows, visible } = useTicketRows();
  const index = data.proposals.findIndex((item) => item.ticket_id === ticketId);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState<string>(ESCALATION_REASONS[0]);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [hint, setHint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const order = visible.some((row) => row.index === index) ? visible : rows;
  const position = order.findIndex((row) => row.index === index);
  const previousId = order[position - 1]?.proposal.ticket_id;
  const nextId = order[position + 1]?.proposal.ticket_id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select"))
        return;

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.key === "j" ? nextId : event.key === "k" ? previousId : undefined;

      if (target) void navigate({ to: "/tickets/$ticketId", params: { ticketId: target } });

      if (event.key === "Escape") setPanel(null);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, nextId, previousId]);

  if (index < 0)
    return (
      <div className="border-t border-divider px-5 py-10 text-center text-muted">
        Ticket not found.{" "}
        <Link to="/tickets" className="text-foreground underline underline-offset-3">
          Return to tickets
        </Link>
      </div>
    );
  const ticket = data.challenge[index];
  const proposal = proposalFor(index);
  const versions = history(index);
  const current = review(index);
  const form = current.form;
  const baseline = startingForm(proposal);
  const info = serviceInfo(form.service);
  const team = info?.[1] ?? "Unknown service";
  const computedPriority = priority(form.urgency, form.impact);
  const changes = formChanges(form, baseline);
  const warnings = reviewWarnings(ticket, form);
  const body = commentBody(form.resolution_comment);
  const log = actions.filter((item) => item.ticket_id === ticketId).reverse();
  const reporterName = ticket.Reporter.split("@")[0].split(".")[0];

  const templates = [
    {
      label: "Resolution summary",
      text: `Diagnosis: ${ticket.Summary}. Action: … Validation: confirmed with ${ticket.Reporter} that ${form.service} works as expected.`,
    },
    {
      label: "Access granted",
      text: `Access to ${form.service} was granted with the standard role requested for ${ticket.Reporter}; the user confirmed they can sign in and complete the task.`,
    },
    {
      label: "Workaround",
      text: `Workaround provided for ${form.service}: … A permanent fix is tracked by ${team}; please reopen if the workaround stops working.`,
    },
  ];

  function update(changed: Partial<FormValues>) {
    edit(index, { ...form, ...changed });
  }

  function goNext() {
    const next =
      order.find((row) => row.index !== index && isOpen(review(row.index).status)) ??
      rows.find((row) => row.index !== index && isOpen(review(row.index).status));

    if (next)
      void navigate({ to: "/tickets/$ticketId", params: { ticketId: next.proposal.ticket_id } });
  }

  function finish(action: string, options?: { reason?: string; message?: string }) {
    act(index, action, options);
    setPanel(null);
    goNext();
  }

  async function askPremium() {
    setPending(true);
    setError(null);

    try {
      await regenerate(index, hint.trim());
      setPanel(null);
      setHint("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Regeneration failed");
    } finally {
      setPending(false);
    }
  }

  const premiumReady = premium.url !== null && premium.online;

  return (
    <>
      <div className="min-w-0">
        <div className="mb-4 block sm:flex sm:items-start sm:justify-between sm:gap-6">
          <div>
            <Eyebrow>
              {ticketId} · {ticket["Request type"]}
            </Eyebrow>
            <PageTitle>{ticket.Summary}</PageTitle>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <StatusPill status={current.status} />
              <PriorityPill row={{ index, ticket, proposal, current }} />
              <Pill>{form.work_type}</Pill>
              <Pill>
                <Dot tone={info?.[2] === "Critical" ? "danger" : "muted"} />
                {info?.[2] ?? "Unknown"} service
              </Pill>
              {versions.length > 0 && (
                <Pill>
                  <Sparkles size={12} strokeWidth={1.75} />
                  Version {current.version ?? 0} of {versions.length}
                </Pill>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm whitespace-nowrap text-muted sm:mt-0">
            <span className="tabular-nums">
              {position + 1} / {order.length}
            </span>
            <span className="inline-flex gap-0.5">
              <Kbd>K</Kbd>
              <Kbd>J</Kbd>
            </span>
            <Link
              to="/tickets/$ticketId"
              params={{ ticketId: previousId ?? ticketId }}
              className={buttonVariants({ size: "icon" })}
              aria-label="Previous ticket"
              disabled={!previousId}
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </Link>
            <Link
              to="/tickets/$ticketId"
              params={{ ticketId: nextId ?? ticketId }}
              className={buttonVariants({ size: "icon" })}
              aria-label="Next ticket"
              disabled={!nextId}
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </Link>
          </div>
        </div>

        <div className="sticky top-2 z-3 mb-4 flex flex-wrap items-center gap-2 rounded-card border bg-elevated/92 p-2 backdrop-blur-sm">
          <Button variant="primary" onClick={() => finish(changes.length ? "modify" : "accept")}>
            <Check size={16} strokeWidth={1.75} />
            {changes.length
              ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""} & resolve`
              : "Accept & resolve"}
          </Button>
          <Button
            className={panelToggle}
            aria-expanded={panel === "escalate"}
            onClick={() => setPanel(panel === "escalate" ? null : "escalate")}
          >
            <TriangleAlert size={16} strokeWidth={1.75} />
            Escalate to L3
          </Button>
          <Button
            className={panelToggle}
            aria-expanded={panel === "clarify"}
            onClick={() => {
              setQuestion(
                `Hi ${reporterName}, could you clarify the requested outcome and confirm which service is affected?`,
              );
              setPanel(panel === "clarify" ? null : "clarify");
            }}
          >
            <CircleHelp size={16} strokeWidth={1.75} />
            Ask clarification
          </Button>
          <Button
            className={panelToggle}
            aria-expanded={panel === "premium"}
            onClick={() => setPanel(panel === "premium" ? null : "premium")}
          >
            <Sparkles size={16} strokeWidth={1.75} />
            Ask a stronger model
          </Button>
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={!current.previous}
            onClick={() => undo(index)}
          >
            <Undo2 size={16} strokeWidth={1.75} />
            Undo
          </Button>
        </div>

        {panel === "escalate" && (
          <Card className={panelCard} aria-label="Escalate ticket">
            <CardHeader className="mb-3.5">
              <div>
                <CardTitle>Escalate to L3 · {team}</CardTitle>
                <CardDescription>
                  The ticket leaves the L2 queue with the current classification and your note.
                </CardDescription>
              </div>
              <CloseButton onClick={() => setPanel(null)} />
            </CardHeader>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="Escalation reason"
            >
              {ESCALATION_REASONS.map((item) => (
                <Chip
                  key={item}
                  role="radio"
                  aria-checked={reason === item}
                  onClick={() => setReason(item)}
                >
                  {item}
                </Chip>
              ))}
            </div>
            <Field className="mt-4">
              Note for the next level {reason === "Other" && "(required)"}
              <Textarea
                rows={3}
                value={note}
                placeholder="What have you checked, and what should L3 look at first?"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <div className={panelActions}>
              <Button
                variant="primary"
                disabled={reason === "Other" && !note.trim()}
                onClick={() =>
                  finish("escalate", {
                    reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
                    message: note.trim() || undefined,
                  })
                }
              >
                Escalate ticket
              </Button>
            </div>
          </Card>
        )}

        {panel === "clarify" && (
          <Card className={panelCard} aria-label="Ask clarification">
            <CardHeader className="mb-3.5">
              <div>
                <CardTitle>Ask {ticket.Reporter} for clarification</CardTitle>
                <CardDescription>
                  Sets Resolution to “clarification” and posts this question as the comment.
                </CardDescription>
              </div>
              <CloseButton onClick={() => setPanel(null)} />
            </CardHeader>
            <Field className="mt-4">
              Question
              <Textarea
                rows={3}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </Field>
            <div className={panelActions}>
              <Button
                variant="primary"
                disabled={!question.trim()}
                onClick={() => finish("clarify", { message: question.trim() })}
              >
                <MessageSquareText size={16} strokeWidth={1.75} />
                Send request
              </Button>
            </div>
          </Card>
        )}

        {panel === "premium" && (
          <Card className={panelCard} aria-label="Ask a stronger model">
            <CardHeader className="mb-3.5">
              <div>
                <CardTitle>Ask a stronger model</CardTitle>
                <CardDescription>
                  {premium.url
                    ? premium.online
                      ? `Re-runs triage on ${premium.model} with your hint. The current proposal stays in the history.`
                      : `The premium solver at ${premium.url} is not reachable.`
                    : "No premium solver is configured. Start one with `python -m triage_poc --model <larger model> serve --port 8766` and set VITE_PREMIUM_SOLVER_URL=http://127.0.0.1:8766."}
                </CardDescription>
              </div>
              <CloseButton onClick={() => setPanel(null)} />
            </CardHeader>
            <Field className="mt-4">
              Hint for the model (required)
              <Textarea
                className="disabled:opacity-50"
                rows={3}
                value={hint}
                disabled={!premiumReady || pending}
                placeholder="e.g. The description is about NAV calculation, not fund pricing; urgency is higher because month-end is today."
                onChange={(event) => setHint(event.target.value)}
              />
            </Field>
            {error && (
              <p className="mt-2.5 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <div className={panelActions}>
              <Button
                variant="primary"
                disabled={!premiumReady || pending || !hint.trim()}
                onClick={() => void askPremium()}
              >
                {pending ? (
                  <LoaderCircle
                    size={16}
                    strokeWidth={1.75}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Sparkles size={16} strokeWidth={1.75} />
                )}
                {pending ? "Regenerating…" : "Regenerate proposal"}
              </Button>
            </div>
          </Card>
        )}

        <Grid>
          <Card className={SPAN[5]}>
            <CardHeader>
              <div>
                <CardTitle>Request</CardTitle>
                <CardDescription>Read only · incoming Jira record</CardDescription>
              </div>
            </CardHeader>
            <p className="text-base leading-prose text-secondary">{ticket.Description}</p>
            <CardSection>Declared fields</CardSection>
            <div className={originalFields}>
              <OriginalField label="Work type" value={ticket["Work type"]} />
              <OriginalField
                label="Service"
                value={ticket["Affected Business or IT Services"].join(", ")}
              />
              <OriginalField
                label="Urgency / Impact / Priority"
                value={`${ticket.Urgency} / ${ticket.Impact} / ${ticket.Priority}`}
              />
              <OriginalField label="Business entity" value={ticket["Business Entity"].join(", ")} />
              <OriginalField label="Reporter" value={ticket.Reporter} />
              <OriginalField label="Created" value={ticket["Created date"]} />
              <OriginalField label="Due date" value={ticket["Due date"]} />
              <OriginalField label="Linked issues" value={ticket["Linked issues"].join(", ")} />
            </div>
            <CardSection>Comments</CardSection>
            <div className="grid">
              {ticket["All Comments"].length ? (
                ticket["All Comments"].map((comment, place) => {
                  const [author, ...rest] = comment.split(":");

                  return (
                    <div key={place} className={commentRow}>
                      <b className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Dot />
                        {author}
                      </b>
                      <p className="mt-1 leading-relaxed text-secondary">{rest.join(":").trim()}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-muted">No comments.</p>
              )}
            </div>
          </Card>

          <Stack className={SPAN[7]}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    Triage decision
                    {data.mock && <MockBadge size="mini">Mock</MockBadge>}
                  </CardTitle>
                  <CardDescription>
                    Proposed by {proposal.model_id} · {STATUS_LABELS[current.status].toLowerCase()}
                  </CardDescription>
                </div>
              </CardHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldGroup>
                  Work type
                  <Segmented full aria-label="Work type">
                    {["Incident", "Service Request"].map((value) => (
                      <SegmentedItem
                        key={value}
                        aria-pressed={form.work_type === value}
                        onClick={() => update({ work_type: value })}
                      >
                        {value}
                        {value === form.work_type && value !== ticket["Work type"] && (
                          <Tag className="px-1.25 py-0 text-3xs">changed</Tag>
                        )}
                      </SegmentedItem>
                    ))}
                  </Segmented>
                </FieldGroup>
                <Field>
                  Service
                  <Select
                    value={form.service}
                    onChange={(event) => update({ service: event.target.value })}
                  >
                    {SERVICES.map(([name, , tier]) => (
                      <option key={name} value={name}>
                        {name} · {tier}
                      </option>
                    ))}
                  </Select>
                </Field>
                <FieldGroup>
                  Team
                  <ReadonlyValue value={team} note="derived" />
                </FieldGroup>
                <Field>
                  Assignee
                  <Select
                    value={form.assignee}
                    onChange={(event) =>
                      update({
                        assignee: event.target.value,
                        resolution_comment: `${event.target.value}: ${body}`,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {proposal.proposal.assignee_candidates.map((candidate) => (
                      <option value={candidate.email} key={candidate.email}>
                        {candidate.email} · {candidate.historical_count} in team
                      </option>
                    ))}
                    {data.assignees
                      .filter(
                        (email) =>
                          !proposal.proposal.assignee_candidates.some(
                            (candidate) => candidate.email === email,
                          ),
                      )
                      .map((email) => (
                        <option value={email} key={email}>
                          {email}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field>
                  Urgency
                  <Select
                    value={form.urgency}
                    onChange={(event) =>
                      update({
                        urgency:
                          LEVELS.find((level) => level === event.target.value) ?? form.urgency,
                      })
                    }
                  >
                    {LEVELS.map((level, place) => (
                      <option value={level} key={level}>
                        {level} — {URGENCY_LABELS[place]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  Impact
                  <Select
                    value={form.impact}
                    onChange={(event) =>
                      update({
                        impact: LEVELS.find((level) => level === event.target.value) ?? form.impact,
                      })
                    }
                  >
                    {LEVELS.map((level, place) => (
                      <option value={level} key={level}>
                        {level} — {IMPACT_LABELS[place]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <FieldGroup>
                  Priority
                  <ReadonlyValue value={computedPriority} note="calculated" />
                </FieldGroup>
                <Field>
                  Resolution
                  <Select
                    value={form.resolution}
                    onChange={(event) =>
                      update({
                        resolution:
                          RESOLUTIONS.find((value) => value === event.target.value) ??
                          form.resolution,
                      })
                    }
                  >
                    {RESOLUTIONS.map((value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="mt-5">
                <span className="text-sm text-muted">
                  Priority matrix · urgency rows × impact columns
                </span>
                <div className="mt-2 grid grid-cols-5 gap-1">
                  {PRIORITY_MATRIX.flatMap((row, urgencyIndex) =>
                    row.map((level, impactIndex) => (
                      <div
                        key={`${urgencyIndex}-${impactIndex}`}
                        className={cn(
                          "grid h-7 place-items-center rounded-lg border border-transparent bg-elevated text-xs font-medium text-muted",
                          form.urgency === LEVELS[urgencyIndex] &&
                            form.impact === LEVELS[impactIndex] &&
                            "border-ring bg-primary-subtle text-primary",
                        )}
                        title={`${LEVELS[urgencyIndex]} urgency / ${LEVELS[impactIndex]} impact`}
                      >
                        {level}
                      </div>
                    )),
                  )}
                </div>
              </div>
              {warnings.length > 0 && (
                <div
                  className="mt-5 grid gap-1.5 rounded-button border border-warning/22 bg-warning/7 px-3.5 py-3 text-sm text-secondary"
                  role="status"
                >
                  <b className="flex items-center gap-2 font-medium text-warning">
                    <TriangleAlert size={16} strokeWidth={1.75} />
                    Review warnings
                  </b>
                  {warnings.map((warning) => (
                    <p key={warning} className="flex items-center gap-2 pl-6">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Response</CardTitle>
                  <CardDescription>
                    Posted to the ticket as the resolution comment when you resolve it.
                  </CardDescription>
                </div>
                <span
                  className={cn(
                    "text-sm whitespace-nowrap text-muted tabular-nums",
                    body.length < 40 && "text-warning",
                  )}
                >
                  {body.length} chars
                </span>
              </CardHeader>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {templates.map((template) => (
                  <Chip
                    key={template.label}
                    onClick={() =>
                      update({ resolution_comment: `${form.assignee}: ${template.text}` })
                    }
                  >
                    {template.label}
                  </Chip>
                ))}
                {body !== commentBody(baseline.resolution_comment) && (
                  <Chip
                    variant="ghost"
                    onClick={() =>
                      update({
                        resolution_comment: `${form.assignee}: ${commentBody(baseline.resolution_comment)}`,
                      })
                    }
                  >
                    Restore AI draft
                  </Chip>
                )}
              </div>
              <div className="rounded-button border bg-shell focus-within:border-ring focus-within:ring-3 focus-within:ring-primary-subtle">
                <span className="flex items-center gap-2 px-3 pt-2 text-sm text-muted">
                  <Dot tone="primary" />
                  {form.assignee || "Unassigned"}
                </span>
                <Textarea
                  className="border-0 bg-transparent focus-visible:ring-0"
                  rows={5}
                  aria-label="Response text"
                  value={body}
                  onChange={(event) =>
                    update({ resolution_comment: `${form.assignee}: ${event.target.value}` })
                  }
                />
              </div>
            </Card>
          </Stack>
        </Grid>

        <Grid>
          <Card className={SPAN[6]}>
            <CardHeader>
              <CardTitle>
                AI rationale{" "}
                {data.mock && proposal.model_id.startsWith("mock") && (
                  <MockBadge size="mini">Mock</MockBadge>
                )}
              </CardTitle>
            </CardHeader>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["work_type", "service"] as const).map((field) => {
                const value = proposal.confidence[field];

                return (
                  <div
                    key={field}
                    className="grid gap-2 rounded-button border bg-elevated px-3.5 py-3"
                  >
                    <span className="flex justify-between text-sm text-secondary">
                      {field === "service" ? "Service" : "Work type"}
                      <span>{confidenceLabel(value)}</span>
                    </span>
                    <b className="text-3xl leading-display font-semibold tracking-tight tabular-nums">
                      {value === null ? "—" : `${Math.round(value * 100)}%`}
                    </b>
                    <Meter value={value ?? 0} />
                  </div>
                );
              })}
            </div>
            <p className="leading-loose text-secondary">{proposal.rationale}</p>
            {proposal.latency_ms != null && (
              <CardDescription>
                Generated in {(proposal.latency_ms / 1000).toFixed(1)} s
              </CardDescription>
            )}
            <CardSection>Proposal vs declared</CardSection>
            <Diff
              label="Service"
              before={ticket["Affected Business or IT Services"][0]}
              after={proposal.proposal.service}
            />
            <Diff
              label="Work type"
              before={ticket["Work type"]}
              after={proposal.proposal.work_type}
            />
            <Diff
              label="Urgency / impact"
              before={`${ticket.Urgency} / ${ticket.Impact}`}
              after={`${proposal.proposal.urgency} / ${proposal.proposal.impact}`}
            />
            <CardSection>Your changes</CardSection>
            {changes.length ? (
              changes.map((item) => (
                <Diff
                  key={item.field}
                  label={item.field.replace("_", " ")}
                  before={item.field === "resolution_comment" ? "AI draft" : item.before}
                  after={item.field === "resolution_comment" ? "edited" : item.after}
                />
              ))
            ) : (
              <p className="text-muted">No operator changes yet.</p>
            )}
          </Card>
          <Stack className={SPAN[6]}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    Similar historical tickets{" "}
                    {data.mock && <MockBadge size="mini">Mock</MockBadge>}
                  </CardTitle>
                  <CardDescription>
                    Example matches by service; similarity has not been measured.
                  </CardDescription>
                </div>
              </CardHeader>
              {proposal.similar_tickets.map((item) => (
                <button
                  className="group flex w-full items-center gap-3 border-t border-divider py-3 text-left text-foreground first-of-type:mt-4"
                  key={item.historical_index}
                  onClick={() =>
                    setSelected(data.historical_examples[String(item.historical_index)])
                  }
                >
                  <History size={16} strokeWidth={1.75} className={similarIcon} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-medium group-hover:underline-subtle">
                      {item.summary}
                    </b>
                    <small className="mt-0.5 block text-sm text-muted">
                      {item.service} · {item.resolution}
                      {item.similarity === null
                        ? ""
                        : ` · ${Math.round(item.similarity * 100)}% similar`}
                    </small>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} className={similarIcon} />
                </button>
              ))}
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>Append-only action log for {ticketId}</CardDescription>
                </div>
              </CardHeader>
              {log.length ? (
                <ol className="grid">
                  {log.map((item) => (
                    <li
                      key={`${item.timestamp}-${item.action}`}
                      className="relative grid gap-0.5 border-l py-2.5 pl-3.5 before:absolute before:top-3.75 before:-left-1 before:size-1.75 before:rounded-full before:bg-muted before:ring-2 before:ring-surface first:before:bg-primary"
                    >
                      <b className="font-medium">{ACTION_LABELS.get(item.action) ?? item.action}</b>
                      <small className="text-xs text-muted">
                        {time(item.timestamp)} · {item.model_id}
                      </small>
                      {item.escalation_reason && (
                        <p className={timelineText}>{item.escalation_reason}</p>
                      )}
                      {item.hint && <p className={timelineText}>Hint: {item.hint}</p>}
                      {item.action === "clarify" && item.message && (
                        <p className={timelineText}>{item.message}</p>
                      )}
                      {item.changed_fields.length > 0 && (
                        <p className={timelineText}>
                          Changed{" "}
                          {item.changed_fields
                            .map((change) => change.field.replace("_", " "))
                            .join(", ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted">No actions yet.</p>
              )}
            </Card>
          </Stack>
        </Grid>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-overlay p-5"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-dialog w-160 max-w-full overflow-auto rounded-float border border-border-hover bg-surface p-6 shadow-float"
            role="dialog"
            aria-modal="true"
            aria-label="Historical ticket"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <CardTitle className="text-lg">{selected.Summary}</CardTitle>
              <CloseButton onClick={() => setSelected(null)} />
            </div>
            <p className="mb-5 leading-loose text-secondary">{selected.Description}</p>
            <div className={originalFields}>
              <OriginalField
                label="Service"
                value={selected["Affected Business or IT Services"].join(", ")}
              />
              <OriginalField label="Team" value={selected["Service Team(s)"].join(", ")} />
              <OriginalField label="Resolution" value={selected.Resolution} />
              <OriginalField label="Assignee" value={selected.Assignee} />
            </div>
            <CardSection>Comments</CardSection>
            <div className="grid">
              {selected["All Comments"].map((comment, place) => (
                <div key={place} className={commentRow}>
                  <p className="leading-relaxed text-secondary">{comment}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  LoaderCircle,
  Search,
  Sigma,
  Sparkles,
  Undo2,
  UserRound,
} from "lucide-react";
import { cva } from "class-variance-authority";
import { useDashboard } from "../state";
import type { Verifiable } from "../state";
import {
  FIELD_LABELS,
  IMPACT_LABELS,
  LEVELS,
  PRIORITY_MATRIX,
  SERVICES,
  TRIAGE_FIELDS,
  URGENCY_LABELS,
  aiValue,
  priority,
  serviceInfo,
  startingTriage,
} from "../domain";
import type { Explanation, IncomingTicket, Proposal, Triage, TriageField } from "../domain";
import { cn } from "../lib/utils";
import {
  optionClass,
  optionEmptyClass,
  optionGroupClass,
  optionHintClass,
  optionSearchClass,
  optionSearchInputClass,
  popoverClass,
} from "./select";
import { Initials, personName } from "./tickets";
import { Fold } from "./ui";
import { Button } from "./ui/button";
import { CardTitle } from "./ui/card";
import { Field, Textarea } from "./ui/form";

/**
 * Who owns a tag's value: the model, the model confirmed by the operator, the operator, the
 * reporter (no AI suggestion for this ticket), or a rule (team follows service, priority the matrix).
 */
export type TagKind = "ai" | "verified" | "human" | "declared" | "derived";

interface Option {
  value: string;
  label: string;
  hint?: string;
  group?: string;
  icon?: ReactNode;
}

const KIND_LABELS: Record<TagKind, string> = {
  ai: "AI suggestion",
  verified: "Confirmed by you",
  human: "Changed by you",
  declared: "Declared by the reporter",
  derived: "Derived",
};

export function tagKind(
  field: TriageField,
  triage: Triage,
  baseline: Triage,
  verified: readonly Verifiable[],
  hasProposal: boolean,
): TagKind {
  if (!hasProposal) return "declared";

  if (triage[field] !== baseline[field]) return "human";

  return verified.includes(field) ? "verified" : "ai";
}

/* Tag chips: who owns the value. Blue = model, green check = confirmed, solid = you,
   dashed = derived by a rule, plain = what the reporter declared. */
const tagChip = cva(
  "group/chip inline-flex h-8 max-w-full items-center gap-1.75 rounded-control border px-2.5 text-left text-base font-medium text-foreground transition duration-150 data-[state=open]:border-ring data-[state=open]:ring-3 data-[state=open]:ring-primary-subtle pointer-coarse:h-10",
  {
    variants: {
      kind: {
        ai: "border-primary/40 bg-primary/10 hover:border-primary-text/60 active:scale-97",
        verified: "border-success/40 bg-success/8 hover:border-success/60 active:scale-97",
        human: "border-border-hover bg-elevated hover:border-foreground/60 active:scale-97",
        declared: "border-border bg-field hover:border-muted/60 active:scale-97",
        derived:
          "cursor-help border-dashed border-border bg-transparent text-secondary hover:border-muted/60",
      },
    },
  },
);

const KIND_COLORS: Record<TagKind, string> = {
  ai: "text-primary-text",
  verified: "text-success",
  human: "text-foreground",
  declared: "text-muted",
  derived: "text-muted",
};

export function KindIcon({
  kind,
  size = 12,
  className,
}: {
  kind: TagKind;
  size?: number;
  className?: string;
}) {
  const props = { size, strokeWidth: 2, className };

  if (kind === "verified") return <Check {...props} />;

  if (kind === "human") return <UserRound {...props} />;

  if (kind === "declared") return <FileText {...props} />;

  if (kind === "derived") return <Sigma {...props} />;

  return <Sparkles {...props} />;
}

function display(field: TriageField, value: string) {
  if (field === "assignee") return value ? personName(value) : "Unassigned";

  return value;
}

/**
 * Why the model suggested this value. Uses the proposal's own explanation when the file carries
 * one; otherwise it is assembled from the model's reason and the facts the dashboard already has.
 */
export function explain(
  field: TriageField,
  ticket: IncomingTicket,
  proposal: Proposal,
): Explanation {
  const supplied = proposal.explanations?.[field];

  if (supplied) return supplied;
  const ai = aiValue(proposal, field) ?? "";

  const declared: Record<TriageField, string | null> = {
    work_type: ticket["Work type"],
    service: ticket["Affected Business or IT Services"][0] ?? null,
    assignee: ticket.Assignee,
    urgency: ticket.Urgency,
    impact: ticket.Impact,
  };

  const evidence: string[] = [];
  let confidence: number | null = null;

  if (field === "assignee") {
    const candidate = proposal.proposal.assignee_candidates[0];

    if (candidate?.support) {
      evidence.push(
        `${personName(candidate.email)} handled ${candidate.historical_count} of ${candidate.support} past tickets for this service and entity`,
      );
      confidence = candidate.historical_count / candidate.support;
    } else if (!candidate) evidence.push("The model did not name an assignee");

    if (proposal.review_flags.includes("assignee_low_confidence"))
      evidence.push("Flagged by the model as a weak suggestion");
  } else {
    const before = declared[field];

    if (before)
      evidence.push(
        before === ai ? `Reporter declared ${before} as well` : `Reporter declared ${before}`,
      );

    if (field === "service") {
      if (proposal.content_clues?.length)
        evidence.push(`Named in the ticket text: ${proposal.content_clues.join(", ")}`);
      const info = serviceInfo(ai);

      if (info) evidence.push(`${info[2]} service owned by ${info[1]}`);
    }
  }

  return {
    reason: proposal.rationale || "The model gave no reason for this suggestion.",
    confidence,
    evidence,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/* Floating layers: the reason tooltip and the value picker. */
const floatingClass = cn(
  "z-20 w-75 max-w-pop text-base leading-normal text-secondary data-[state=closed]:animate-pop-out",
  popoverClass,
);

const reasonPopClass = cn(
  floatingClass,
  "origin-(--radix-tooltip-content-transform-origin) px-3.5 py-3 data-[state=delayed-open]:animate-pop-in",
);

const arrowClass = "fill-tooltip";

export function ReasonHead({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-foreground">
      {icon}
      <b className="min-w-0 flex-1 truncate font-semibold">{title}</b>
      {children}
    </div>
  );
}

/** Hover card explaining a suggestion. It holds no controls, so a tooltip is the right surface. */
export function Reason({
  title,
  explanation,
  modelId,
  footer,
}: {
  title: string;
  explanation: Explanation;
  modelId: string;
  footer: string;
}) {
  return (
    <>
      <ReasonHead
        icon={<Sparkles size={14} strokeWidth={1.75} className="text-primary-text" />}
        title={title}
      >
        {explanation.confidence !== null && (
          <span
            className={cn(
              "font-semibold text-foreground tabular-nums",
              explanation.confidence < 0.5 && "text-warning",
            )}
          >
            {percent(explanation.confidence)}
          </span>
        )}
      </ReasonHead>
      <p>{explanation.reason}</p>
      {explanation.evidence.length > 0 && (
        <ul className="mt-2.5 grid list-none gap-1">
          {explanation.evidence.map((line) => (
            <li
              key={line}
              className="relative pl-3 before:absolute before:top-2 before:left-0 before:size-1 before:rounded-full before:bg-muted"
            >
              {line}
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-2.5 flex justify-between gap-3 border-t border-divider pt-2 text-sm text-muted">
        <span>{modelId}</span>
        <span>{footer}</span>
      </footer>
    </>
  );
}

export function ReasonTooltip({
  children,
  side = "left",
  align = "center",
  trigger,
}: {
  children: ReactNode;
  side?: "left" | "top";
  align?: "start" | "center";
  trigger: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={reasonPopClass}
          side={side}
          align={align}
          sideOffset={10}
          collisionPadding={12}
        >
          {children}
          <Tooltip.Arrow className={arrowClass} width={12} height={6} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function OptionList({
  label,
  options,
  value,
  ai,
  onPick,
}: {
  label: string;
  options: Option[];
  value: string;
  ai: string | null;
  onPick: (value: string) => void;
}) {
  const [needle, setNeedle] = useState("");
  const searchable = options.length > 10;
  const query = needle.trim().toLowerCase();

  const shown = query
    ? options.filter((option) =>
        `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(query),
      )
    : options;

  return (
    <>
      {searchable && (
        <label className={optionSearchClass}>
          <Search size={14} strokeWidth={1.75} />
          <span className="sr-only">Filter options</span>
          <input
            autoFocus
            className={optionSearchInputClass}
            value={needle}
            placeholder="Search…"
            onChange={(event) => setNeedle(event.target.value)}
          />
        </label>
      )}
      <ul className="max-h-66 list-none overflow-y-auto p-1" role="listbox" aria-label={label}>
        {shown.map((option, index) => (
          <li key={option.value} role="presentation">
            {option.group && option.group !== shown[index - 1]?.group && (
              <span className={optionGroupClass}>{option.group}</span>
            )}
            <div
              role="option"
              aria-selected={option.value === value}
              className={cn(
                optionClass,
                "hover:bg-active focus-visible:bg-active focus-visible:outline-none",
              )}
              tabIndex={0}
              onClick={() => onPick(option.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick(option.value);
                }
              }}
            >
              {option.icon}
              <span className="flex min-w-0 flex-1 flex-col items-start">
                {option.label}
                {option.hint && (
                  <small className={cn(optionHintClass, "whitespace-normal")}>{option.hint}</small>
                )}
              </span>
              {option.value === ai && (
                <Sparkles size={12} strokeWidth={2} aria-label="AI suggestion" />
              )}
              {option.value === value && <Check size={14} strokeWidth={2} />}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className={optionEmptyClass}>No matches</li>}
      </ul>
    </>
  );
}

function ProposedTag({
  field,
  value,
  ai,
  kind,
  explanation,
  options,
  modelId,
  onChange,
  onVerify,
}: {
  field: TriageField;
  value: string;
  ai: string | null;
  kind: TagKind;
  explanation: Explanation | null;
  options: Option[];
  modelId: string | null;
  onChange: (value: string) => void;
  onVerify: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const label = FIELD_LABELS[field];

  const chip = (
    <Popover.Trigger asChild>
      <button
        className={tagChip({ kind })}
        aria-label={`${label}: ${display(field, value)}, ${KIND_LABELS[kind]}`}
      >
        <KindIcon kind={kind} className={KIND_COLORS[kind]} />
        <span className="truncate">{display(field, value)}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className="ml-auto text-muted opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 group-data-[state=open]/chip:opacity-100"
        />
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {explanation && modelId ? (
        <Tooltip.Root open={tip && !open} onOpenChange={setTip}>
          <Tooltip.Trigger asChild>{chip}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className={reasonPopClass}
              side="left"
              sideOffset={10}
              collisionPadding={12}
            >
              <Reason
                title={
                  kind === "human"
                    ? `AI suggested ${display(field, ai ?? "")}`
                    : `Why ${display(field, ai ?? "")}`
                }
                explanation={explanation}
                modelId={modelId}
                footer={
                  kind === "human"
                    ? `You changed it to ${display(field, value)}`
                    : kind === "verified"
                      ? "Confirmed by you"
                      : "Click to confirm or change"
                }
              />
              <Tooltip.Arrow className={arrowClass} width={12} height={6} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        chip
      )}
      <Popover.Portal>
        <Popover.Content
          className={cn(
            floatingClass,
            "flex origin-(--radix-popover-content-transform-origin) flex-col data-[state=open]:animate-pop-in",
          )}
          side="left"
          align="start"
          sideOffset={10}
          collisionPadding={12}
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2 font-semibold text-foreground">
            <b>{label}</b>
            <span className="font-normal text-muted">{KIND_LABELS[kind]}</span>
          </div>
          <OptionList
            label={label}
            options={options}
            value={value}
            ai={ai}
            onPick={(picked) => {
              onChange(picked);
              setOpen(false);
            }}
          />
          {kind !== "declared" && (
            <div className="flex justify-end border-t border-divider p-1.5">
              {kind === "human" ? (
                <Button
                  variant="ghost"
                  className="h-8 pointer-coarse:h-8"
                  onClick={() => {
                    onChange(ai ?? "");
                    setOpen(false);
                  }}
                >
                  <Undo2 size={14} strokeWidth={1.75} />
                  Restore AI suggestion
                </Button>
              ) : (
                <Button
                  variant={kind === "verified" ? "ghost" : "primary"}
                  className="h-8 pointer-coarse:h-8"
                  onClick={() => {
                    onVerify(kind !== "verified");
                    setOpen(false);
                  }}
                >
                  <Check size={14} strokeWidth={2} />
                  {kind === "verified" ? "Undo confirmation" : "Confirm suggestion"}
                </Button>
              )}
            </div>
          )}
          <Popover.Arrow className={arrowClass} width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DerivedTag({ value, children }: { value: string; children: ReactNode }) {
  return (
    <ReasonTooltip
      trigger={
        <button className={tagChip({ kind: "derived" })} aria-label={`${value}, derived`}>
          <KindIcon kind="derived" className={KIND_COLORS.derived} />
          <span className="truncate">{value}</span>
        </button>
      }
    >
      {children}
    </ReasonTooltip>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-11.5 grid-cols-class-row items-center gap-2 border-t border-divider px-1.5 py-1 first:border-t-0">
      <span className="grid text-sm font-medium text-secondary">
        {label}
        {hint && <small className="text-xs font-normal text-muted">{hint}</small>}
      </span>
      {children}
    </div>
  );
}

const levelOptions = (labels: string[]): Option[] =>
  LEVELS.map((value, place) => ({ value, label: value, hint: labels[place] }));

export function ClassificationSidebar({ index }: { index: number }) {
  const { data, review, proposalFor, update, verify, regenerate, stronger } = useDashboard();
  const ticket = data.challenge[index];
  const proposal = proposalFor(index);
  const current = review(index);
  const { triage } = current;
  const baseline = startingTriage(ticket, proposal);
  const verified = current.verified ?? [];
  const [strongerOpen, setStrongerOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds = new Map(
    TRIAGE_FIELDS.map(
      (field) => [field, tagKind(field, triage, baseline, verified, proposal !== null)] as const,
    ),
  );

  const remaining = TRIAGE_FIELDS.filter((field) => kinds.get(field) === "ai");
  const changed = TRIAGE_FIELDS.filter((field) => kinds.get(field) === "human");
  const settled = TRIAGE_FIELDS.length - remaining.length;
  const info = serviceInfo(triage.service);
  const team = info?.[1] ?? "Unknown team";
  // Tickets without urgency or impact in Jira keep the priority Jira holds.
  const level = priority(triage.urgency, triage.impact) ?? triage.priority ?? "";
  const candidates = proposal?.proposal.assignee_candidates ?? [];
  const set = (values: Partial<Triage>) => update(index, { triage: { ...triage, ...values } });

  const flags = [
    proposal?.review_flags.includes("injection_removed")
      ? "Instruction-like text was removed from this ticket before the AI read it."
      : "",
  ].filter(Boolean);

  async function askStronger() {
    setPending(true);
    setError(null);

    try {
      await regenerate(index, hint.trim());
      setStrongerOpen(false);
      setHint("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The stronger model could not produce a suggestion.",
      );
    } finally {
      setPending(false);
    }
  }

  const assigneeOptions: Option[] = [
    { value: "", label: "Unassigned" },
    ...candidates.map((candidate) => ({
      value: candidate.email,
      label: personName(candidate.email),
      hint: candidate.support
        ? `${candidate.historical_count} of ${candidate.support} similar tickets`
        : candidate.email,
      group: "Suggested from history",
      icon: <Initials email={candidate.email} />,
    })),
    ...data.assignees.flatMap((email) =>
      candidates.some((candidate) => candidate.email === email)
        ? []
        : [
            {
              value: email,
              label: personName(email),
              hint: email,
              group: "All agents",
              icon: <Initials email={email} />,
            },
          ],
    ),
  ];

  const serviceOptions: Option[] = SERVICES.map(([name, owner, rating]) => ({
    value: name,
    label: name,
    hint: owner,
    group: `${rating} services`,
  })).sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));

  const tag = (field: TriageField, options: Option[]) => (
    <ProposedTag
      field={field}
      value={triage[field] ?? ""}
      ai={aiValue(proposal, field)}
      kind={kinds.get(field) ?? "declared"}
      explanation={proposal ? explain(field, ticket, proposal) : null}
      options={options}
      modelId={proposal?.model_id ?? null}
      onChange={(value) => {
        if (field === "urgency" || field === "impact") {
          const known = LEVELS.find((item) => item === value);

          if (known) set({ [field]: known });
        } else set({ [field]: value });
      }}
      onVerify={(on) => verify(index, [field], on)}
    />
  );

  const done = proposal !== null && remaining.length === 0;

  return (
    <aside
      className="sticky top-23 flex max-h-rail flex-col gap-4 overflow-y-auto rounded-card border bg-surface shadow-card max-lg:static max-lg:max-h-none"
      aria-label="Classification"
    >
      <div className="flex items-center gap-3.5 border-b border-divider px-card-pad py-4.5">
        <span
          className={cn(
            "grid size-7 flex-none place-items-center rounded-full bg-primary-subtle font-display text-sm font-semibold text-primary-text",
            done && "bg-success/15 text-success",
          )}
        >
          {done ? <Check size={14} strokeWidth={2.5} /> : "1"}
        </span>
        <div>
          <CardTitle className="text-lg">Classification</CardTitle>
          <p className="mt-0.5 text-sm text-muted">
            {!proposal
              ? "No AI suggestion. Values are what the reporter declared."
              : done
                ? "Every suggestion confirmed or changed."
                : `${remaining.length} suggestion${remaining.length > 1 ? "s" : ""} to review${
                    changed.length ? ` · ${changed.length} changed` : ""
                  }`}
          </p>
        </div>
        {proposal && (
          <span className="ml-auto text-muted tabular-nums">
            {settled}/{TRIAGE_FIELDS.length}
          </span>
        )}
      </div>
      <div className="grid gap-4 px-5 pb-5">
        {proposal && (
          <div className="flex h-1 overflow-hidden rounded-pill bg-hover" role="presentation">
            <span
              className="rounded-pill bg-primary transition-all duration-200"
              style={{ width: `${(settled / TRIAGE_FIELDS.length) * 100}%` }}
            />
          </div>
        )}

        <div className="-mx-1.5 grid">
          <Row label="Work type">
            {tag("work_type", [
              { value: "Incident", label: "Incident" },
              { value: "Service Request", label: "Service Request" },
            ])}
          </Row>
          <Row label="Service" hint={info?.[2] ?? "Unknown rating"}>
            {tag("service", serviceOptions)}
          </Row>
          <Row label="Team" hint="from service">
            <DerivedTag value={team}>
              <ReasonHead
                icon={<Sigma size={14} strokeWidth={1.75} className="text-muted" />}
                title="Follows the service"
              />
              <p>
                Each service belongs to exactly one team, so {triage.service} routes to {team}.
              </p>
            </DerivedTag>
          </Row>
          <Row label="Assignee">{tag("assignee", assigneeOptions)}</Row>
          <Row label="Urgency">{tag("urgency", levelOptions(URGENCY_LABELS))}</Row>
          <Row label="Impact">{tag("impact", levelOptions(IMPACT_LABELS))}</Row>
          <Row label="Priority" hint="from matrix">
            <DerivedTag value={level}>
              <ReasonHead
                icon={<Sigma size={14} strokeWidth={1.75} className="text-muted" />}
                title="Set by the service desk matrix"
              />
              <p>
                Urgency {triage.urgency} × impact {triage.impact} give {level}
                {level !== ticket.Priority && ` · reporter declared ${ticket.Priority}`}. Change
                urgency or impact to move it.
              </p>
              <div className="mt-2.5 grid grid-cols-5 gap-1" aria-hidden="true">
                {PRIORITY_MATRIX.flatMap((row, urgencyIndex) =>
                  row.map((cell, impactIndex) => (
                    <div
                      key={`${urgencyIndex}-${impactIndex}`}
                      className={cn(
                        "grid h-6 place-items-center rounded-cell border border-transparent bg-surface text-xs font-medium text-muted",
                        triage.urgency === LEVELS[urgencyIndex] &&
                          triage.impact === LEVELS[impactIndex] &&
                          "border-ring bg-primary-subtle text-primary-text",
                      )}
                    >
                      {cell}
                    </div>
                  )),
                )}
              </div>
            </DerivedTag>
          </Row>
        </div>

        {remaining.length > 0 && (
          <Button className="w-full" onClick={() => verify(index, remaining, true)}>
            <CheckCheck size={16} strokeWidth={1.75} />
            Confirm the {remaining.length} remaining suggestion{remaining.length > 1 ? "s" : ""}
          </Button>
        )}

        {proposal && (
          <Fold
            layout="sidebar"
            icon={<Sparkles size={16} strokeWidth={1.75} />}
            title="Why the model suggests this"
          >
            <div className="grid gap-2.5">
              <blockquote className="border-l-2 border-primary px-3.5 py-2.5 text-base leading-comment text-secondary">
                {proposal.rationale || "The model gave no reason."}
              </blockquote>
              {flags.map((flag) => (
                <p className="text-sm text-warning" key={flag}>
                  {flag}
                </p>
              ))}
              <p className="text-muted">Suggested by {proposal.model_id}</p>
            </div>
          </Fold>
        )}

        {stronger.configured && current.status !== "resolved" && (
          <div>
            {!strongerOpen && (
              <Button
                className="w-full"
                disabled={!stronger.online}
                data-tip={
                  stronger.online ? undefined : "The stronger model is currently unavailable"
                }
                onClick={() => setStrongerOpen(true)}
              >
                <Sparkles size={16} strokeWidth={1.75} />
                Ask a stronger model
              </Button>
            )}
            {strongerOpen && (
              <div className="rounded-tile border bg-shell p-3.5">
                <Field>
                  What should the model take into account?
                  <Textarea
                    rows={3}
                    value={hint}
                    disabled={pending}
                    placeholder="For example: the reporter means NAV calculation, not fund pricing."
                    onChange={(event) => setHint(event.target.value)}
                  />
                </Field>
                {error && (
                  <p className="mt-2.5 text-sm text-danger" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStrongerOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={pending || !hint.trim()}
                    onClick={() => void askStronger()}
                  >
                    {pending ? (
                      <LoaderCircle size={16} strokeWidth={1.75} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} strokeWidth={1.75} />
                    )}
                    {pending ? "Asking…" : "Get new suggestion"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

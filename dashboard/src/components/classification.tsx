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
import { Initials, personName } from "./tickets";

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

export function KindIcon({ kind, size = 12 }: { kind: TagKind; size?: number }) {
  const props = { size, strokeWidth: 2, className: "kind-icon" };

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

export function ReasonHead({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="reason-head">
      {icon}
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
      <ReasonHead icon={<Sparkles size={14} strokeWidth={1.75} className="kind-icon" />}>
        <b>{title}</b>
        {explanation.confidence !== null && (
          <span
            className={
              explanation.confidence < 0.5 ? "reason-confidence low num" : "reason-confidence num"
            }
          >
            {percent(explanation.confidence)}
          </span>
        )}
      </ReasonHead>
      <p>{explanation.reason}</p>
      {explanation.evidence.length > 0 && (
        <ul className="reason-evidence">
          {explanation.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <footer>
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
          className="reason-pop"
          side={side}
          align={align}
          sideOffset={10}
          collisionPadding={12}
        >
          {children}
          <Tooltip.Arrow className="pop-arrow" width={12} height={6} />
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
        <label className="select-search">
          <Search size={14} strokeWidth={1.75} />
          <span className="sr-only">Filter options</span>
          <input
            autoFocus
            value={needle}
            placeholder="Search…"
            onChange={(event) => setNeedle(event.target.value)}
          />
        </label>
      )}
      <ul className="edit-list" role="listbox" aria-label={label}>
        {shown.map((option, index) => (
          <li key={option.value} role="presentation">
            {option.group && option.group !== shown[index - 1]?.group && (
              <span className="select-group">{option.group}</span>
            )}
            <div
              role="option"
              aria-selected={option.value === value}
              className="select-option"
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
              <span>
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
              {option.value === ai && (
                <Sparkles size={12} strokeWidth={2} aria-label="AI suggestion" />
              )}
              {option.value === value && <Check size={14} strokeWidth={2} />}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="select-empty">No matches</li>}
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
        className={`tag-chip ${kind}`}
        aria-label={`${label}: ${display(field, value)}, ${KIND_LABELS[kind]}`}
      >
        <KindIcon kind={kind} />
        <span className="tag-value">{display(field, value)}</span>
        <ChevronDown size={12} strokeWidth={2} className="tag-caret" />
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
              className="reason-pop"
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
              <Tooltip.Arrow className="pop-arrow" width={12} height={6} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        chip
      )}
      <Popover.Portal>
        <Popover.Content
          className="edit-pop"
          side="left"
          align="start"
          sideOffset={10}
          collisionPadding={12}
        >
          <div className="edit-head">
            <b>{label}</b>
            <span className="muted">{KIND_LABELS[kind]}</span>
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
            <div className="edit-foot">
              {kind === "human" ? (
                <button
                  className="button ghost"
                  onClick={() => {
                    onChange(ai ?? "");
                    setOpen(false);
                  }}
                >
                  <Undo2 size={14} strokeWidth={1.75} />
                  Restore AI suggestion
                </button>
              ) : (
                <button
                  className={kind === "verified" ? "button ghost" : "button primary"}
                  onClick={() => {
                    onVerify(kind !== "verified");
                    setOpen(false);
                  }}
                >
                  <Check size={14} strokeWidth={2} />
                  {kind === "verified" ? "Undo confirmation" : "Confirm suggestion"}
                </button>
              )}
            </div>
          )}
          <Popover.Arrow className="pop-arrow" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DerivedTag({ value, children }: { value: string; children: ReactNode }) {
  return (
    <ReasonTooltip
      trigger={
        <button className="tag-chip derived" aria-label={`${value}, derived`}>
          <KindIcon kind="derived" />
          <span className="tag-value">{value}</span>
        </button>
      }
    >
      {children}
    </ReasonTooltip>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="class-row">
      <span className="class-label">
        {label}
        {hint && <small>{hint}</small>}
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

  return (
    <aside className="classify" aria-label="Classification">
      <div className="classify-head">
        <div className="classify-title">
          <h2>Classification</h2>
          {proposal && (
            <span className="num muted">
              {settled} / {TRIAGE_FIELDS.length}
            </span>
          )}
        </div>
        {proposal && (
          <div className="classify-meter" role="presentation">
            <span style={{ width: `${(settled / TRIAGE_FIELDS.length) * 100}%` }} />
          </div>
        )}
        <p>
          {!proposal
            ? "No AI suggestion for this ticket. Values are what the reporter declared."
            : remaining.length === 0
              ? "Every AI suggestion has been confirmed or changed."
              : `${remaining.length} AI suggestion${remaining.length > 1 ? "s" : ""} still to review${
                  changed.length ? ` · ${changed.length} changed by you` : ""
                }.`}
        </p>
      </div>

      <div className="class-rows">
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
            <ReasonHead icon={<Sigma size={14} strokeWidth={1.75} className="kind-icon muted" />}>
              <b>Follows the service</b>
            </ReasonHead>
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
            <ReasonHead icon={<Sigma size={14} strokeWidth={1.75} className="kind-icon muted" />}>
              <b>Set by the service desk matrix</b>
            </ReasonHead>
            <p>
              Urgency {triage.urgency} × impact {triage.impact} give {level}
              {level !== ticket.Priority && ` · reporter declared ${ticket.Priority}`}. Change
              urgency or impact to move it.
            </p>
            <div className="matrix-grid mini" aria-hidden="true">
              {PRIORITY_MATRIX.flatMap((row, urgencyIndex) =>
                row.map((cell, impactIndex) => (
                  <div
                    key={`${urgencyIndex}-${impactIndex}`}
                    className={
                      triage.urgency === LEVELS[urgencyIndex] &&
                      triage.impact === LEVELS[impactIndex]
                        ? "selected"
                        : ""
                    }
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
        <button className="button confirm-all" onClick={() => verify(index, remaining, true)}>
          <CheckCheck size={16} strokeWidth={1.75} />
          Confirm the {remaining.length} remaining suggestion{remaining.length > 1 ? "s" : ""}
        </button>
      )}

      {proposal && (
        <div className="classify-reason">
          <h3>Why the model suggests this</h3>
          <blockquote className="ai-reason">
            {proposal.rationale || "The model gave no reason."}
          </blockquote>
          {flags.map((flag) => (
            <p className="flag" key={flag}>
              {flag}
            </p>
          ))}
          <p className="muted">Suggested by {proposal.model_id}</p>
        </div>
      )}

      {stronger.configured && current.status !== "resolved" && (
        <div className="classify-stronger">
          {!strongerOpen && (
            <button
              className="button"
              disabled={!stronger.online}
              data-tip={stronger.online ? undefined : "The stronger model is currently unavailable"}
              onClick={() => setStrongerOpen(true)}
            >
              <Sparkles size={16} strokeWidth={1.75} />
              Ask a stronger model
            </button>
          )}
          {strongerOpen && (
            <div className="inline-panel">
              <label className="textarea-label">
                What should the model take into account?
                <textarea
                  rows={3}
                  value={hint}
                  disabled={pending}
                  placeholder="For example: the reporter means NAV calculation, not fund pricing."
                  onChange={(event) => setHint(event.target.value)}
                />
              </label>
              {error && (
                <p className="error-line" role="alert">
                  {error}
                </p>
              )}
              <div className="panel-actions">
                <button className="button ghost" onClick={() => setStrongerOpen(false)}>
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={pending || !hint.trim()}
                  onClick={() => void askStronger()}
                >
                  {pending ? (
                    <LoaderCircle size={16} strokeWidth={1.75} className="spin" />
                  ) : (
                    <Sparkles size={16} strokeWidth={1.75} />
                  )}
                  {pending ? "Asking…" : "Get new suggestion"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

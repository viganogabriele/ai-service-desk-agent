import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, MoreHorizontal, X } from "lucide-react";
import { OUTCOMES, OUTCOME_LABELS } from "../domain";
import type { Outcome } from "../domain";
import { personName } from "./tickets";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Field, Textarea, fieldClass } from "./ui/form";

export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const focusable = panel.current?.querySelector<HTMLElement>("textarea, input, button");
    focusable?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);

      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-10 grid animate-fade-in place-items-center bg-overlay p-5 max-sm:items-end max-sm:justify-items-stretch max-sm:p-0"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panel}
        className="max-h-dialog w-160 max-w-full animate-dialog-in overflow-auto rounded-float bg-surface p-6 shadow-popover max-sm:max-h-sheet max-sm:w-full max-sm:rounded-b-none max-sm:px-4 max-sm:pt-5 max-sm:pb-sheet-b"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg leading-5 font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <Button size="icon" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.75} />
          </Button>
        </div>
        <div className="grid gap-4">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-2 max-sm:flex-wrap">{footer}</div>
      </div>
    </div>
  );
}

export function Menu({
  label,
  items,
  className,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
  // Applied to the trigger button.
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <Button
        size="icon"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
      </Button>
      {open && (
        <div
          className="absolute top-full right-0 z-20 mt-1.5 grid min-w-55 origin-top-right animate-pop-in rounded-tile bg-tooltip p-1 shadow-popover"
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={cn(
                "h-8.5 rounded-option px-2.5 text-left text-base text-foreground hover:bg-active focus-visible:bg-active pointer-coarse:min-h-10",
                item.danger && "text-danger",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A comment written as the ticket assignee; Jira comments are stored as `email: text`. */
export function CommentEditor({
  author,
  value,
  onChange,
  label,
  placeholder,
  rows = 6,
  draft = false,
}: {
  author: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  rows?: number;
  // An AI draft stays yellow until it is approved or edited.
  draft?: boolean;
}) {
  return (
    <Field>
      {label}
      <span
        className={cn(
          "block rounded-tile border bg-field transition duration-120 ease-out focus-within:border-ring focus-within:ring-3 focus-within:ring-primary-subtle",
          draft &&
            "border-accent/40 bg-draft focus-within:border-accent focus-within:ring-accent-subtle",
        )}
      >
        <span className="flex items-center gap-2 px-3.5 pt-2.5 text-sm text-muted">
          {author ? `Posted as ${personName(author)} · ${author}` : "Choose an assignee to post as"}
        </span>
        <Textarea
          className="border-0 bg-transparent focus-visible:ring-0"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </Field>
  );
}

export function OutcomePicker({
  value,
  onChange,
}: {
  value: Outcome;
  onChange: (value: Outcome) => void;
}) {
  return (
    <div className={fieldClass}>
      Outcome
      <div
        className="flex w-full gap-0.5 overflow-x-auto rounded-tile border bg-shell p-0.75 scrollbar-none"
        role="radiogroup"
        aria-label="Outcome"
      >
        {OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            type="button"
            role="radio"
            aria-checked={value === outcome}
            aria-pressed={value === outcome}
            className="inline-flex h-7.5 flex-1 items-center justify-center gap-1.5 rounded-control px-3.5 text-sm font-medium whitespace-nowrap text-nav transition duration-150 ease-soft hover:bg-hover hover:text-secondary aria-pressed:bg-elevated aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border-hover"
            onClick={() => onChange(outcome)}
          >
            {OUTCOME_LABELS[outcome]}
          </button>
        ))}
      </div>
    </div>
  );
}

const FOLD_LAYOUTS = {
  // Full-bleed at the bottom of a card, divided from what is above it.
  card: {
    details: "border-t border-divider",
    inset: "px-card-pad",
    summary: "py-3.5",
    body: "pb-5",
  },
  // The classification sidebar has narrower padding than a card.
  sidebar: {
    details: "-mx-5 border-t border-divider last:-mb-5",
    inset: "px-5",
    summary: "py-3.5",
    body: "pb-5",
  },
  // A framed panel inside a step, like the option cards above it.
  framed: { details: "rounded-tile border", inset: "px-3.5", summary: "py-3", body: "pb-3.5" },
};

/** Folded secondary content: a `details` block that opens on demand. */
export function Fold({
  icon,
  title,
  count,
  defaultOpen = false,
  layout = "card",
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  layout?: keyof typeof FOLD_LAYOUTS;
  children: ReactNode;
}) {
  const classes = FOLD_LAYOUTS[layout];

  return (
    <details
      className={cn(
        "group/fold interpolate-keywords",
        // Browsers that can animate to auto height unfold the content; the rest just open.
        "details-content:h-0 details-content:overflow-hidden details-content:opacity-0 details-content:transition-all details-content:transition-discrete details-content:duration-240 details-content:ease-out open:details-content:h-auto open:details-content:opacity-100",
        classes.details,
      )}
      open={defaultOpen}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2.5 text-base font-medium text-secondary transition-colors duration-150 ease-soft select-none hover:text-foreground [&::-webkit-details-marker]:hidden",
          classes.inset,
          classes.summary,
        )}
      >
        {icon}
        {title}
        {count !== undefined && (
          <span className="font-normal text-muted tabular-nums">{count}</span>
        )}
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          className="ml-auto text-muted transition-transform duration-220 ease-out group-open/fold:rotate-180"
        />
      </summary>
      <div className={cn(classes.inset, classes.body)}>{children}</div>
    </details>
  );
}

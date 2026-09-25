import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreHorizontal, X } from "lucide-react";
import { OUTCOMES, OUTCOME_LABELS } from "../domain";
import type { Outcome } from "../domain";
import { personName } from "./tickets";
import { cn } from "../lib/utils";
import { useDashboard } from "../state";
import { popoverClass } from "./select";
import { Button } from "./ui/button";
import { Field, Kbd, Textarea, fieldClass } from "./ui/form";

const MOD_LABEL = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Ctrl+Enter (⌘+Enter on a Mac) inside a textarea, so a comment can be sent without leaving the keyboard. */
const isSubmitKey = (event: KeyboardEvent) =>
  event.key === "Enter" && (event.metaKey || event.ctrlKey);

/**
 * Modal dialog on Radix: focus is trapped inside, the page behind stops scrolling, Escape and a
 * click that starts on the backdrop close it, and focus returns to the trigger afterwards.
 */
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
  const content = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-10 grid animate-fade-in place-items-center overflow-y-auto bg-overlay p-5 max-sm:items-end max-sm:justify-items-stretch max-sm:p-0">
          <DialogPrimitive.Content
            ref={content}
            className="max-h-dialog w-160 max-w-full animate-dialog-in overflow-auto rounded-float bg-surface p-6 shadow-popover outline-none max-sm:max-h-sheet max-sm:w-full max-sm:rounded-b-none max-sm:px-4 max-sm:pt-5 max-sm:pb-sheet-b"
            // Radix expects a description; without one it must not point at a missing element.
            {...(description ? {} : { "aria-describedby": undefined })}
            // The first field is where typing starts; a dialog without one opens on its first button.
            onOpenAutoFocus={(event) => {
              const field = content.current?.querySelector<HTMLElement>("textarea, input");

              if (!field) return;
              event.preventDefault();
              field.focus();
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <DialogPrimitive.Title className="font-display text-lg leading-5 font-semibold">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <Button size="icon" aria-label="Close">
                  <X size={16} strokeWidth={1.75} />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="grid gap-4">{children}</div>
            <div className="mt-5 flex items-center justify-end gap-2 max-sm:flex-wrap">
              {footer}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Overflow menu on Radix: arrow keys and type-ahead move through the items, Escape and a choice return focus to the trigger. */
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
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size="icon" className={className} aria-label={label}>
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-20 grid min-w-55 origin-(--radix-dropdown-menu-content-transform-origin) p-1 data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            popoverClass,
          )}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              className={cn(
                "flex h-8.5 cursor-pointer items-center rounded-option px-2.5 text-base text-foreground outline-none select-none data-highlighted:bg-active pointer-coarse:min-h-10",
                item.danger && "text-danger",
              )}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The shortcut that submits a comment editor, shown next to its primary button. */
export function SubmitHint() {
  return (
    <span
      className="inline-flex gap-0.75 max-md:hidden touch:hidden"
      data-tip={`${MOD_LABEL} + Enter submits`}
    >
      <Kbd>{MOD_LABEL}</Kbd>
      <Kbd>↵</Kbd>
    </span>
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
  onSubmit,
}: {
  author: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  rows?: number;
  // An AI draft stays yellow until it is approved or edited.
  draft?: boolean;
  // Runs on Ctrl/⌘+Enter; leave it out while the action is not available.
  onSubmit?: () => void;
}) {
  const { signIn } = useDashboard();

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
          {!author
            ? "Choose an assignee to post as"
            : signIn?.user
              ? `Posted by ${signIn.user.name} · ${signIn.user.email}`
              : `Posted as ${personName(author)} · ${author}`}
        </span>
        <Textarea
          className="border-0 bg-transparent focus-visible:ring-0"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (onSubmit && isSubmitKey(event)) {
              event.preventDefault();
              onSubmit();
            }
          }}
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

import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** A label above its control. */
export function Field({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn(fieldClass, className)} {...props} />;
}

/** For a labelled group that is not a `label`, such as a radio group. */
export const fieldClass = "flex min-w-0 flex-col gap-2 text-sm font-medium text-secondary";

export const focusRing =
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-primary-subtle focus-visible:outline-none";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "field-sizing-content max-h-100 min-h-textarea w-full resize-none rounded-tile border bg-field px-3.5 py-3 text-md leading-relaxed font-normal text-foreground hover:border-border-hover pointer-coarse:text-lg",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-check border px-1 font-sans text-xs text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Checkbox drawn from theme tokens. Wrap it in `CheckHit` for a larger target. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "inline-grid size-4 flex-none cursor-pointer appearance-none place-content-center rounded-check border-hairline border-muted/70 bg-field transition duration-120 ease-out",
        "before:size-2.5 before:scale-0 before:bg-white before:transition-transform before:duration-120 before:ease-out before:mask-check",
        "hover:not-checked:not-indeterminate:border-secondary checked:border-primary checked:bg-primary checked:before:scale-100 indeterminate:border-primary indeterminate:bg-primary indeterminate:before:scale-100 indeterminate:before:mask-dash",
        "active:scale-90 disabled:cursor-not-allowed disabled:opacity-35",
        "pointer-coarse:size-5 pointer-coarse:rounded-cell pointer-coarse:before:size-3",
        className,
      )}
      {...props}
    />
  );
}

export function CheckHit({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "-m-2.5 inline-flex cursor-pointer p-2.5 has-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

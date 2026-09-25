import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Page section heading: blue title, a count chip, one line of context. The same on every page. */
export function SectionHead({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-4 flex min-h-9 flex-wrap items-center gap-x-3.5 gap-y-2", className)}
      {...props}
    />
  );
}

export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "inline-flex items-center gap-2.5 font-display text-3xl leading-title font-semibold tracking-snug text-primary-text",
        className,
      )}
      {...props}
    />
  );
}

export function SectionCount({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-grid h-5.5 min-w-6.5 place-items-center rounded-pill bg-primary-subtle px-2 font-sans text-sm font-semibold tracking-normal text-primary-text tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function SectionText({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-base text-muted", className)} {...props} />;
}

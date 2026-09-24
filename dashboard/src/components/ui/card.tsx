import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("min-w-0 rounded-card border bg-surface p-4 sm:p-5", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("mb-5 flex items-start justify-between gap-4", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "flex items-center gap-2 text-md leading-5 font-semibold tracking-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-sm text-muted", className)} {...props} />;
}

/** Small uppercase heading that separates blocks inside a card. */
export function CardSection({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("mt-6 mb-3 text-xs font-medium tracking-caps text-muted uppercase", className)}
      {...props}
    />
  );
}

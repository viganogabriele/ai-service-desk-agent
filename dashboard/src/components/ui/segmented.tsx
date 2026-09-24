import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Pill toggle group. Items are buttons whose `aria-pressed` marks the selection. */
export function Segmented({
  className,
  full = false,
  ...props
}: ComponentProps<"div"> & { full?: boolean }) {
  return (
    <div
      role="group"
      className={cn(
        "group/segmented flex max-w-full gap-0.5 overflow-x-auto rounded-full border bg-shell p-0.75 scrollbar-none",
        full && "w-full rounded-button",
        className,
      )}
      data-full={full || undefined}
      {...props}
    />
  );
}

export function SegmentedItem({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap text-nav hover:bg-hover hover:text-secondary aria-pressed:bg-active aria-pressed:text-foreground group-data-full/segmented:flex-1 group-data-full/segmented:justify-center group-data-full/segmented:rounded-control",
        className,
      )}
      {...props}
    />
  );
}

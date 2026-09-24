import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const dotVariants = cva("inline-block size-1.5 flex-none rounded-full", {
  variants: {
    tone: {
      muted: "bg-muted",
      secondary: "bg-secondary",
      foreground: "bg-foreground",
      primary: "bg-primary",
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-danger",
      info: "bg-info",
    },
  },
  defaultVariants: { tone: "muted" },
});

export type Tone = NonNullable<VariantProps<typeof dotVariants>["tone"]>;

export function Dot({ className, tone }: { className?: string; tone?: Tone }) {
  return <i className={cn(dotVariants({ tone }), className)} />;
}

export function Pill({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center gap-1.5 rounded-full border px-2 text-sm font-medium whitespace-nowrap text-secondary",
        className,
      )}
      {...props}
    />
  );
}

const mockVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border border-warning/22 font-medium tracking-caps whitespace-nowrap text-warning uppercase",
  {
    variants: {
      size: {
        default: "h-6 bg-warning/10 px-2.5 text-xs",
        mini: "h-4.5 px-1.5 align-middle text-2xs",
      },
    },
    defaultVariants: { size: "default" },
  },
);

/** Marks figures that come from mock fixtures rather than a solver run. */
export function MockBadge({
  className,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof mockVariants>) {
  return <span className={cn(mockVariants({ size }), className)} {...props} />;
}

export function Tag({
  className,
  tone = "default",
  ...props
}: ComponentProps<"em"> & { tone?: "default" | "warning" }) {
  return (
    <em
      className={cn(
        "rounded-full border px-1.5 py-px text-2xs font-medium tracking-wide text-muted uppercase not-italic",
        tone === "warning" && "border-warning/30 text-warning",
        className,
      )}
      {...props}
    />
  );
}

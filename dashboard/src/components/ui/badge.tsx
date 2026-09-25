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

export function Dot({
  className,
  tone,
  ...props
}: ComponentProps<"i"> & VariantProps<typeof dotVariants>) {
  return <i className={cn(dotVariants({ tone }), className)} {...props} />;
}

export function Pill({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.75 rounded-pill border px-2.5 text-sm font-medium whitespace-nowrap text-secondary",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Priority mark. Red for the two urgent levels, yellow for medium, green for the two low ones.
 * Only Highest is filled, so a solid badge always means "drop everything".
 */
export const badgeVariants = cva(
  "inline-flex h-5.5 items-center gap-1.5 rounded-pill pr-2.25 pl-1.75 font-display text-xs font-semibold tracking-caps whitespace-nowrap uppercase [&_svg]:size-3",
  {
    variants: {
      tone: {
        highest: "bg-danger text-danger-foreground",
        high: "bg-danger/9 text-danger inset-ring inset-ring-danger/45",
        medium: "bg-warning/9 text-warning inset-ring inset-ring-warning/45",
        low: "bg-success/9 text-success inset-ring inset-ring-success/45",
        lowest: "bg-success/9 text-success opacity-70 inset-ring inset-ring-success/45",
        none: "bg-muted/9 text-muted inset-ring inset-ring-muted/45",
        critical: "gap-1.75 pl-2.25 text-secondary inset-ring inset-ring-secondary/45",
      },
    },
    defaultVariants: { tone: "none" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const avatarVariants = cva(
  "inline-grid flex-none place-items-center rounded-full bg-active text-2xs font-semibold tracking-initials text-secondary",
  {
    variants: {
      size: {
        default: "size-6",
        sm: "size-5",
      },
      empty: {
        true: "border border-dashed border-border-hover bg-transparent",
        false: "",
      },
    },
    defaultVariants: { size: "default", empty: false },
  },
);

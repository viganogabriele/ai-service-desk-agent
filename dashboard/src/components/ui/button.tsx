import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Also applied to router `Link`s and to spans that should look like buttons. */
export const buttonVariants = cva(
  [
    "inline-flex h-9 items-center justify-center gap-2 rounded-button border border-border bg-elevated text-base font-medium whitespace-nowrap text-foreground transition-control duration-150 ease-soft",
    "hover:border-border-hover hover:bg-elevated-hover hover:text-foreground active:scale-97",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
    // Arrows lean the way they point while the pointer is on their button.
    "[&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-out",
    "hover:[&_.lucide-arrow-right]:translate-x-0.5 hover:[&_.lucide-chevron-right]:translate-x-0.5 hover:[&_.lucide-chevrons-right]:translate-x-0.5",
    "hover:[&_.lucide-arrow-left]:-translate-x-0.5 hover:[&_.lucide-chevron-left]:-translate-x-0.5",
  ],
  {
    variants: {
      variant: {
        default: "",
        // Yellow: the one action a card or step is for.
        primary:
          "border-transparent bg-action font-semibold text-action-foreground hover:border-transparent hover:bg-action-hover hover:text-action-foreground hover:shadow-glow hover:shadow-action/70",
        blue: "border-transparent bg-primary font-semibold text-white hover:border-transparent hover:bg-primary-hover hover:text-white",
        danger:
          "border-transparent bg-danger font-semibold text-danger-foreground hover:border-transparent hover:bg-danger-hover hover:text-danger-foreground hover:shadow-glow hover:shadow-danger/70",
        ghost:
          "border-transparent bg-transparent text-secondary hover:border-transparent hover:bg-hover",
      },
      size: {
        default: "px-3.5 pointer-coarse:h-10.5",
        sm: "h-7.5 px-3.5 text-sm",
        large: "h-10.5 px-4.5 text-md",
        icon: "w-9 p-0 text-secondary pointer-coarse:size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & ButtonVariants) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** An underlined text action inside a sentence or a status line. */
export const linkButtonClass =
  "inline-flex items-center gap-1 text-sm font-medium text-secondary underline decoration-border-hover underline-offset-3 hover:text-foreground";

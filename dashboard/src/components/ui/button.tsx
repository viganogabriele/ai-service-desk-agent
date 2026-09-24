import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Also applied to router `Link`s that should look like buttons. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border rounded-button text-base font-medium whitespace-nowrap hover:not-disabled:border-border-hover hover:not-disabled:bg-elevated-hover hover:not-disabled:text-foreground disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "border-border bg-elevated text-foreground",
        primary:
          "border-transparent bg-primary font-semibold text-primary-foreground hover:not-disabled:border-transparent hover:not-disabled:bg-primary-hover hover:not-disabled:text-primary-foreground",
        ghost:
          "border-transparent bg-transparent text-secondary hover:not-disabled:border-transparent hover:not-disabled:bg-hover",
      },
      size: {
        default: "h-8.5 px-3",
        icon: "size-8 p-0 text-secondary",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

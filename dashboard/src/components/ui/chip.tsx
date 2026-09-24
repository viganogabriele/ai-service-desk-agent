import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Rounded choice button. With `role="radio"`, `aria-checked` shows the selection. */
export function Chip({
  className,
  variant = "default",
  ...props
}: ComponentProps<"button"> & { variant?: "default" | "ghost" }) {
  return (
    <button
      className={cn(
        "h-7.5 rounded-full border bg-transparent px-3 text-sm font-medium text-secondary hover:border-border-hover hover:text-foreground aria-checked:border-ring aria-checked:bg-primary-subtle aria-checked:text-primary",
        variant === "ghost" && "border-dashed",
        className,
      )}
      {...props}
    />
  );
}

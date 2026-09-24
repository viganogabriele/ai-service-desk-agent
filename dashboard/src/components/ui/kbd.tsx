import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-kbd border px-1 font-sans text-xs text-muted",
        className,
      )}
      {...props}
    />
  );
}

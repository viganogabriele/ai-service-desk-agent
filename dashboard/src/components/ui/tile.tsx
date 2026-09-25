import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Meta tiles: the small labelled boxes such as "Service" and "Requested by". */
export function Tiles({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-tiles gap-2.5", className)} {...props} />;
}

export function Tile({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid min-w-0 gap-1.25 rounded-tile bg-elevated px-3 py-2.5", className)}
      {...props}
    />
  );
}

export function TileLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-2xs font-semibold tracking-caps text-muted uppercase [&_svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export function TileValue({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 truncate text-base font-medium text-foreground [&>span]:min-w-0 [&>span]:truncate",
        className,
      )}
      {...props}
    />
  );
}

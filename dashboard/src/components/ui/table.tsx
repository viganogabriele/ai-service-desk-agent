import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Scroll container that lets a table bleed to the card edges. */
export function TableScroll({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("-mx-4 overflow-x-auto sm:-mx-5", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full min-w-240 border-collapse", className)} {...props} />;
}

const edgePadding = "first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-9 border-t border-divider px-2.5 text-left text-xs font-medium tracking-caps whitespace-nowrap text-muted uppercase",
        edgePadding,
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "h-13 border-t border-divider px-2.5 py-1.5 align-middle text-base whitespace-nowrap text-secondary",
        edgePadding,
        className,
      )}
      {...props}
    />
  );
}

/** Secondary line under a cell's main value. */
export function CellNote({ className, ...props }: ComponentProps<"small">) {
  return <small className={cn("mt-px block text-sm text-muted", className)} {...props} />;
}

import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function PageHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-6 block sm:flex sm:items-end sm:justify-between sm:gap-6", className)}
      {...props}
    />
  );
}

export function Eyebrow({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("mb-2 block text-xs font-medium tracking-caps text-muted uppercase", className)}
      {...props}
    />
  );
}

export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={cn("mb-1.5 text-4xl leading-title font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-md text-secondary", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "mt-8 mb-3 flex items-center gap-2 text-base leading-5 font-semibold tracking-subtle text-secondary",
        className,
      )}
      {...props}
    />
  );
}

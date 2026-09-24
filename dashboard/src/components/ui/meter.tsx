import { cn } from "../../lib/utils";

/** Thin progress track; `value` is a 0–1 share. */
export function Meter({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "neutral";
  className?: string;
}) {
  return (
    <span className={cn("flex h-1 gap-0.5 overflow-hidden rounded-full bg-hover", className)}>
      <span
        className={cn("rounded-full", tone === "primary" ? "bg-primary" : "bg-secondary")}
        style={{ width: `${value * 100}%` }}
      />
    </span>
  );
}

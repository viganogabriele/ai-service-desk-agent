import type { ReactNode } from "react";

/** The value a proposal or operator replaced, shown before a `ChangeArrow`. */
export function OldValue({ children }: { children: ReactNode }) {
  return <span className="text-muted line-through decoration-white/20">{children}</span>;
}

export function ChangeArrow() {
  return <span className="mx-1.5 text-muted">→</span>;
}

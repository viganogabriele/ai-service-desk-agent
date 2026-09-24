import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const fieldClass = "flex min-w-0 flex-col gap-2 text-sm font-medium text-secondary";

/** Label above a control. Wrap the control so the label is associated with it. */
export function Field({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn(fieldClass, className)} {...props} />;
}

/** Same layout as `Field` for groups and read-only values that have no single control. */
export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(fieldClass, className)} {...props} />;
}

const controlClass =
  "w-full rounded-button border bg-shell text-base font-normal text-foreground hover:border-border-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-primary-subtle focus-visible:outline-none";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        controlClass,
        "h-9 appearance-none text-ellipsis bg-chevron pr-8 pl-3",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(controlClass, "resize-y px-3 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

/**
 * Bordered box holding an input plus icons or units, focused as one control. Render it `as`
 * a label when nothing else labels the input.
 */
export function InputGroup({
  className,
  as: Element = "span",
  ...props
}: Omit<ComponentProps<"span">, "ref"> & { as?: "span" | "label" }) {
  return (
    <Element
      className={cn(
        "flex h-9 items-center rounded-button border bg-shell px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-primary-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function ReadonlyValue({ value, note }: { value: string; note: string }) {
  return (
    <div className="flex h-9 w-full items-center justify-between gap-2 rounded-button border border-dashed px-3 text-base font-medium">
      <strong className="truncate font-medium text-foreground">{value}</strong>
      <span className="text-muted">{note}</span>
    </div>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn("size-3.5 cursor-pointer accent-primary", className)}
      {...props}
    />
  );
}

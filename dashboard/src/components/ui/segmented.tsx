import { cn } from "../../lib/utils";

/** A row of toggle buttons for one choice, in the pill track of the view switch. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex rounded-pill border bg-surface p-1", className)}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className="h-8 rounded-pill px-3.5 font-display text-sm font-semibold whitespace-nowrap text-nav transition-colors duration-150 ease-soft hover:text-secondary aria-pressed:bg-thumb aria-pressed:text-primary-text aria-pressed:inset-ring aria-pressed:inset-ring-primary/55 max-sm:px-2.5"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

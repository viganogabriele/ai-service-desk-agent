import { useMemo } from "react";
import { tokenizeJson } from "../lib/blind-test";
import type { JsonToken } from "../lib/blind-test";
import { cn } from "../lib/utils";

// Editor-like colours from the theme tokens, so both themes keep their contrast.
const TOKEN_CLASS: Record<JsonToken["type"], string | undefined> = {
  key: "text-primary-text",
  string: "text-success",
  number: "text-warning",
  literal: "text-danger",
  punctuation: "text-muted",
  space: undefined,
};

/** The fixed-height, inner-scrolling frame the JSON blocks and their stand-ins share. */
export const codeFrame =
  "h-code w-full overflow-auto rounded-tile border bg-field p-4 font-mono text-sm leading-relaxed";

/** Pretty-printed, coloured JSON in a fixed-height block that scrolls inside. */
export function JsonBlock({
  value,
  label,
  className,
}: {
  value: unknown;
  label: string;
  className?: string;
}) {
  const tokens = useMemo(() => tokenizeJson(JSON.stringify(value, null, 2)), [value]);

  return (
    <pre className={cn(codeFrame, "text-foreground", className)} aria-label={label} tabIndex={0}>
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.type]}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

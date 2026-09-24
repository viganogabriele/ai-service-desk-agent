import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the theme's custom scales and utilities so it only drops real conflicts.
const merge = extendTailwindMerge({
  // Theme font sizes carry no line-height (see index.css), so `text-*` must not drop `leading-*`.
  override: {
    conflictingClassGroups: { "font-size": [] },
  },
  extend: {
    theme: {
      leading: ["display", "kpi", "title", "snug", "normal", "relaxed", "loose", "prose"],
      tracking: ["tightest", "tighter", "tight", "snug", "subtle", "wide", "caps"],
      radius: ["kbd", "control", "button", "card", "float"],
      shadow: ["float", "rail-active"],
    },
    // Custom `@utility` classes from index.css, so they are not mistaken for colors.
    classGroups: {
      "bg-image": [{ bg: ["chevron", "dashed-key"] }],
      "grid-cols": [
        {
          "grid-cols": [
            "app",
            "workspace",
            "workspace-compact",
            "diff",
            "correction",
            "bar-row",
            "economics",
            "board",
          ],
        },
      ],
      "max-w": [{ "max-w": ["summary"] }],
      "max-h": [{ "max-h": ["rail", "dialog"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}

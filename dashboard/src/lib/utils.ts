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
      text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"],
      spacing: [
        "page",
        "section",
        "card-gap",
        "card-pad",
        "dialog",
        "sheet",
        "rail",
        "column",
        "toast",
        "popover",
        "pop",
        "thumb",
        "strip-card",
        "upcoming-card",
        "textarea",
        "code",
        "safe-l",
        "safe-r",
        "safe-b",
        "sheet-b",
        "stage",
      ],
      leading: ["title", "snug", "normal", "relaxed", "kpi", "heading", "comment", "choice"],
      tracking: ["tight", "snug", "normal", "caps", "group", "initials"],
      radius: ["check", "cell", "option", "control", "tile", "button", "card", "float", "pill"],
      shadow: ["card", "popover", "float", "glow", "thumb"],
      ease: ["out", "soft"],
    },
    // Custom `@utility` classes and theme grid templates from index.css.
    classGroups: {
      "bg-image": [{ bg: ["dashed-key"] }],
      "border-w": [{ border: ["hairline"] }],
      "grid-cols": [
        {
          "grid-cols": [
            "workspace",
            "workspace-compact",
            "tiles",
            "tiles-wide",
            "board",
            "board-swipe",
            "details",
            "class-row",
            "bar-row",
            "bar-row-compact",
            "correction",
            "queue-row",
            "queue-row-plain",
            "queue-skeleton",
            "notification",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}

import { useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";

export type Theme = "light" | "dark";

// Keep in sync with the pre-paint script in index.html.
const STORAGE_KEY = "service-desk-theme";

const THEME_COLORS: Record<Theme, string> = { dark: "#121212", light: "#eef0f2" };

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

// The theme lives on <html>, so every toggle (sidebar on phones, header on desktop) stays in step.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

/**
 * Swaps the theme with every transition switched off for one frame, so the page changes colour at
 * once instead of hundreds of elements fading on their own schedules.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove("theme-switching")),
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  // The icon only turns in after a click, not when the page first paints.
  const [turned, setTurned] = useState(false);

  return (
    <Button
      size="icon"
      className={className}
      aria-label={`Switch to ${next} theme`}
      data-tip={`Switch to ${next} theme`}
      onClick={() => {
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
        setTurned(true);
      }}
    >
      {theme === "dark" ? (
        <Sun
          key="sun"
          size={16}
          strokeWidth={1.75}
          className={turned ? "animate-turn-in" : undefined}
        />
      ) : (
        <Moon
          key="moon"
          size={16}
          strokeWidth={1.75}
          className={turned ? "animate-turn-in" : undefined}
        />
      )}
    </Button>
  );
}

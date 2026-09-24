import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

// Keep in sync with the pre-paint script in index.html.
const STORAGE_KEY = "service-desk-theme";

const THEME_COLORS: Record<Theme, string> = { dark: "#070909", light: "#eceeed" };

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

// The theme lives on <html>, so every toggle (sidebar on phones, header on desktop) stays in step.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      className={`icon-button ${className}`}
      aria-label={`Switch to ${next} theme`}
      data-tip={`Switch to ${next} theme`}
      onClick={() => {
        localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.dataset.theme = next;
        document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute("content", THEME_COLORS[next]);
      }}
    >
      {theme === "dark" ? (
        <Sun size={16} strokeWidth={1.75} />
      ) : (
        <Moon size={16} strokeWidth={1.75} />
      )}
    </button>
  );
}

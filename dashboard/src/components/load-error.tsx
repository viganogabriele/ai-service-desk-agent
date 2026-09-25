import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Cloud, Copy, RotateCw, Server, Terminal } from "lucide-react";
import { Fold } from "./ui";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import logo from "../assets/logo.png";

export interface LoadFailure {
  /** False when nothing answered: no backend and no bundled data file to fall back on. */
  answered: boolean;
  message: string;
  backendUrl: string;
  /** When the last attempt failed, in epoch milliseconds. Each new failure restarts the countdown. */
  failedAt: number;
  retrying: boolean;
  retry: () => void;
}

const RETRY_SECONDS = 10;

const START_BACKEND = "cd backend && bun run dev";

const clock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * The tickets could not be loaded. The connection strip shows which link failed; the page retries on
 * its own and says when, and the technical details stay folded for whoever has to fix it.
 */
export function LoadError({ failure }: { failure: LoadFailure }) {
  const { answered, message, backendUrl, failedAt, retrying, retry } = failure;
  const host = backendUrl.replace(/^https?:\/\//, "");

  return (
    <section
      className="grid max-w-150 animate-rise-in gap-7 pt-stage max-md:pt-8"
      aria-labelledby="load-error-title"
    >
      <ConnectionStrip answered={answered} checking={retrying} />
      <div className="grid gap-3" role="alert">
        <h1
          id="load-error-title"
          className="font-display text-4xl leading-heading font-semibold tracking-snug text-balance text-strong max-sm:text-2xl"
        >
          {answered ? "The backend couldn’t load tickets" : "Can’t reach the TicketBuddy backend"}
        </h1>
        <p className="max-w-prose text-md leading-relaxed text-pretty text-secondary">
          {answered ? (
            <>
              The backend at <span className="text-foreground">{host}</span> answered with an error:
              “{message.replace(/\.$/, "")}”. Check its log for the cause; this page tries again on
              its own.
            </>
          ) : (
            <>
              Tickets come from the backend at <span className="text-foreground">{host}</span>, and
              it didn’t answer. Start it, and this page reconnects on its own.
            </>
          )}
        </p>
      </div>
      {!answered && <Command text={START_BACKEND} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button variant="primary" size="large" disabled={retrying} onClick={retry}>
          <RotateCw size={16} strokeWidth={2} className={cn(retrying && "animate-spin")} />
          {retrying ? "Checking…" : "Retry now"}
        </Button>
        {!retrying && <Countdown key={failedAt} onElapsed={retry} />}
      </div>
      <Fold
        layout="framed"
        icon={<Terminal size={15} strokeWidth={1.75} />}
        title="Technical details"
      >
        <dl className="grid gap-2 text-sm [&>div]:grid [&>div]:grid-cols-details [&>div]:gap-3 max-sm:[&>div]:grid-cols-1 max-sm:[&>div]:gap-0.5 [&_dd]:wrap-anywhere [&_dd]:text-secondary [&_dt]:text-muted">
          <div>
            <dt>Request</dt>
            <dd>GET {backendUrl}/tickets</dd>
          </div>
          {!answered && (
            <>
              <div>
                <dt>Result</dt>
                <dd>No response: the connection was refused or blocked.</dd>
              </div>
              <div>
                <dt>Fallback</dt>
                <dd>No bundled ticket file (dashboard-data.json) to show instead.</dd>
              </div>
            </>
          )}
          <div>
            <dt>Last attempt</dt>
            <dd className="tabular-nums">{clock(failedAt)}</dd>
          </div>
        </dl>
      </Fold>
    </section>
  );
}

/**
 * The path a ticket takes to this page: dashboard, backend, Jira. The failed link is broken and
 * red; while a retry runs, a signal travels along the first link.
 */
function ConnectionStrip({ answered, checking }: { answered: boolean; checking: boolean }) {
  return (
    <ol
      className="flex items-start"
      aria-label={
        answered ? "The backend answered with an error" : "The dashboard cannot reach the backend"
      }
    >
      <Node
        label="Dashboard"
        caption="Running"
        icon={<img src={logo} alt="" width={22} height={22} className="size-5.5" />}
        tone="ok"
      />
      <Hop broken={!answered} checking={checking} />
      <Node
        label="Backend"
        caption={checking ? "Checking…" : answered ? "Returned an error" : "Not answering"}
        icon={<Server size={18} strokeWidth={1.75} />}
        tone="failed"
      />
      <Hop idle />
      <Node
        label="Jira"
        caption="Not checked"
        icon={<Cloud size={18} strokeWidth={1.75} />}
        tone="idle"
      />
    </ol>
  );
}

function Node({
  label,
  caption,
  icon,
  tone,
}: {
  label: string;
  caption: string;
  icon: ReactNode;
  tone: "ok" | "failed" | "idle";
}) {
  return (
    <li className="grid w-24 flex-none justify-items-center gap-2 text-center max-sm:w-20">
      <span
        className={cn(
          "relative grid size-12 place-items-center rounded-tile border bg-surface text-secondary shadow-card",
          tone === "failed" && "border-danger/45 bg-danger/8 text-danger",
          tone === "idle" && "border-dashed border-border-hover bg-transparent text-muted",
        )}
      >
        {icon}
        {tone !== "idle" && (
          <i
            className={cn(
              "absolute -top-0.75 -right-0.75 size-2.5 rounded-full ring-3 ring-background",
              tone === "ok" ? "bg-success" : "bg-danger",
            )}
          />
        )}
      </span>
      <span className="grid gap-0.5">
        <span
          className={cn("text-sm font-medium", tone === "idle" ? "text-muted" : "text-foreground")}
        >
          {label}
        </span>
        <span className="text-xs whitespace-nowrap text-muted">{caption}</span>
      </span>
    </li>
  );
}

/** The line between two nodes, drawn through the middle of the 48px icons. */
function Hop({
  broken = false,
  checking = false,
  idle = false,
}: {
  broken?: boolean;
  checking?: boolean;
  idle?: boolean;
}) {
  return (
    <li className="relative mt-6 h-px min-w-6 flex-1 overflow-hidden" aria-hidden="true">
      <span
        className={cn(
          "absolute inset-0",
          idle
            ? "border-t border-dashed border-border-hover"
            : broken
              ? "border-t border-dashed border-danger/70"
              : "bg-border-hover",
        )}
      />
      {checking && (
        <span className="absolute inset-0 flex animate-probe justify-end">
          <span className="h-px w-8 bg-linear-to-r from-transparent to-primary" />
        </span>
      )}
    </li>
  );
}

/** A shell command with a copy button that confirms for a moment after copying. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);

    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex h-12 max-w-110 items-center gap-3 rounded-tile border bg-field pr-1.5 pl-4">
      <span className="text-muted select-none" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-base text-foreground">{text}</code>
      <Button
        size="icon"
        variant="ghost"
        aria-label={copied ? "Copied" : "Copy command"}
        data-tip={copied ? "Copied" : "Copy command"}
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      >
        {copied ? (
          <Check size={15} strokeWidth={2} className="text-success" />
        ) : (
          <Copy size={15} strokeWidth={1.75} />
        )}
      </Button>
    </div>
  );
}

/** Counts down to the next automatic retry. Remount it (a new `key`) to start over. */
function Countdown({ onElapsed }: { onElapsed: () => void }) {
  const [left, setLeft] = useState(RETRY_SECONDS);

  useEffect(() => {
    if (left === 0) return onElapsed();
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);

    return () => window.clearTimeout(timer);
  }, [left, onElapsed]);

  return <span className="text-sm text-muted tabular-nums">Trying again in {left} s</span>;
}

import { Link, Outlet, createRootRoute, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChartColumn, FlaskConical, Gem, Rows3, SquareKanban, Undo2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import type { Notice } from "../state";
import { TicketFiltersProvider, useTicketFilters } from "../components/tickets";
import type { TicketFilters } from "../components/tickets";
import { ThemeToggle } from "../components/theme";
import { TooltipLayer } from "../components/tooltip";
import { Button, buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import logo from "../assets/logo.svg";

export const Route = createRootRoute({ component: Root });

// The operator shown in the top bar. There is no sign-in yet; the desk has one reviewer.
const OPERATOR = { initials: "LC", name: "Lorenzo Corallo" };

const TOPBAR_ICON =
  "size-11 rounded-pill border-transparent bg-surface hover:border-transparent hover:bg-elevated max-md:size-10";

const VIEWS: { view: TicketFilters["view"]; label: string; icon: LucideIcon }[] = [
  { view: "priority", label: "Priority", icon: Gem },
  { view: "table", label: "List", icon: Rows3 },
  { view: "board", label: "Kanban", icon: SquareKanban },
];

function Root() {
  const matchRoute = useMatchRoute();
  const playground = Boolean(matchRoute({ to: "/playground" }));

  return (
    <TicketFiltersProvider>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={400}>
        {playground ? (
          <Shell playground />
        ) : (
          <DashboardProvider>
            <Shell />
          </DashboardProvider>
        )}
      </Tooltip.Provider>
    </TicketFiltersProvider>
  );
}

function Shell({ playground = false }: { playground?: boolean }) {
  const { filters } = useTicketFilters();
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const onDetail = Boolean(matchRoute({ to: "/tickets/$ticketId" }));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-6 flex h-19 items-center gap-8 bg-background/88 px-page backdrop-blur-bar max-lg:gap-4 max-md:h-16 max-sm:gap-2">
        <Link
          to="/tickets"
          className="inline-flex h-11 items-center gap-3.5 rounded-button font-display text-xl font-semibold whitespace-nowrap text-strong"
          aria-label="TicketBuddy home"
        >
          <img src={logo} alt="" width={32} height={32} className="block size-8" />
          <span className="max-lg:hidden">TicketBuddy</span>
        </Link>
        <ViewSwitch active={onTickets ? filters.view : null} />
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/overview"
            className={cn(
              buttonVariants({ size: "icon" }),
              TOPBAR_ICON,
              "data-[status=active]:bg-elevated data-[status=active]:text-primary-text",
            )}
            aria-label="Overview"
            data-tip="Overview"
          >
            <ChartColumn size={18} strokeWidth={1.75} />
          </Link>
          <Link
            to="/playground"
            className={cn(
              buttonVariants({ size: "icon" }),
              TOPBAR_ICON,
              "data-[status=active]:bg-elevated data-[status=active]:text-primary-text",
            )}
            aria-label="Model playground"
            data-tip="Model playground"
          >
            <FlaskConical size={18} strokeWidth={1.75} />
          </Link>
          <ThemeToggle className={TOPBAR_ICON} />
          <span
            className="ml-1 grid size-11 place-items-center rounded-full bg-elevated font-display text-md font-medium tracking-initials text-strong max-md:size-9"
            role="img"
            aria-label={OPERATOR.name}
            data-tip={OPERATOR.name}
          >
            {OPERATOR.initials}
          </span>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto w-full max-w-430 flex-1 px-page pt-3 pb-16 max-md:has-data-bulk-bar:pb-24",
          onDetail && "max-w-none",
        )}
      >
        <Outlet />
      </main>
      {!playground && <Toast />}
      <TooltipLayer />
    </div>
  );
}

/**
 * One track, three equal segments and a thumb that slides to the active one. The thumb is placed
 * from `data-active`, so nothing is measured; off the ticket pages it fades out.
 */
function ViewSwitch({ active }: { active: TicketFilters["view"] | null }) {
  const { filters, setFilters } = useTicketFilters();

  return (
    <nav
      className="group/switch relative isolate grid flex-none auto-cols-fr grid-flow-col rounded-pill border bg-surface p-1"
      aria-label="Ticket views"
      data-active={active ?? undefined}
    >
      <span
        className="absolute inset-y-1 left-1 -z-1 w-thumb rounded-pill bg-thumb opacity-0 shadow-thumb shadow-primary/18 inset-ring inset-ring-primary/55 transition duration-280 ease-out will-change-transform group-data-active/switch:opacity-100 group-data-[active=board]/switch:translate-x-2/1 group-data-[active=table]/switch:translate-x-full"
        aria-hidden="true"
      />
      {VIEWS.map(({ view, label, icon: Icon }) => (
        <Link
          key={view}
          to="/tickets"
          search={{ view }}
          activeProps={{}}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-pill px-5 font-display text-md font-semibold whitespace-nowrap text-nav transition-colors duration-150 hover:text-secondary aria-[current=page]:text-primary-text max-md:px-4 max-sm:px-2 [&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-out hover:not-aria-[current=page]:[&_svg]:-translate-y-px"
          aria-current={view === active ? "page" : undefined}
          aria-label={label}
          onClick={() => setFilters({ view, status: view === "table" ? filters.status : "all" })}
        >
          <Icon size={17} strokeWidth={1.9} />
          <span className="max-md:hidden">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

const TOAST_MS = 8000;

function Toast() {
  const { notice, dismissNotice } = useDashboard();

  if (!notice) return null;

  return <ToastCard notice={notice} onDismiss={dismissNotice} />;
}

/** Dismisses itself after a while, but not while the pointer or keyboard focus is on it, so Undo stays reachable. */
function ToastCard({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);

    return () => window.clearTimeout(timer);
  }, [notice, held, onDismiss]);

  return (
    <div
      className="fixed right-6 bottom-6 z-30 flex max-w-toast animate-toast-in items-center gap-2 rounded-tile bg-popover py-2 pr-2 pl-4 shadow-popover max-sm:right-safe-r max-sm:bottom-safe-b max-sm:left-safe-l max-sm:max-w-none"
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
      }}
    >
      <span className="flex-1">{notice.message}</span>
      {notice.undo && (
        <Button
          variant="ghost"
          onClick={() => {
            notice.undo?.();
            onDismiss();
          }}
        >
          <Undo2 size={14} strokeWidth={1.75} />
          Undo
        </Button>
      )}
      <Button size="icon" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} strokeWidth={1.75} />
      </Button>
    </div>
  );
}

import { Link, Outlet, createRootRoute, useMatchRoute, useParams } from "@tanstack/react-router";
import { ChartColumn, ChevronRight, Download, Inbox, RotateCcw, Waypoints } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { COMPLETED_STATUSES } from "../domain";
import { TicketFiltersProvider } from "../components/tickets";
import { Button } from "../components/ui/button";
import { Dot, MockBadge } from "../components/ui/badge";
import { Meter } from "../components/ui/meter";
import { cn } from "../lib/utils";

export const Route = createRootRoute({ component: Root });

const navItem =
  "relative flex h-8.5 items-center gap-2.5 rounded-control px-2.5 text-base font-medium text-nav hover:bg-hover hover:text-secondary current:bg-active current:text-foreground current:before:absolute current:before:inset-y-2.5 current:before:left-0 current:before:w-0.5 current:before:rounded-full current:before:bg-primary";

const sourceLine = "flex items-center gap-2 text-sm text-muted";

function Root() {
  return (
    <DashboardProvider>
      <TicketFiltersProvider>
        <Shell />
      </TicketFiltersProvider>
    </DashboardProvider>
  );
}

function Shell() {
  const { data, review, reset, exportData, premium } = useDashboard();
  const { ticketId } = useParams({ strict: false });
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const total = data.challenge.length;

  const completed = data.challenge.filter((_, index) =>
    COMPLETED_STATUSES.includes(review(index).status),
  ).length;

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-app">
      <aside className="static flex h-auto flex-row items-center gap-3 p-3 md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:gap-6 md:px-3 md:py-4">
        <Link
          to="/"
          className="flex h-9 items-center gap-2.5 px-2 text-base font-semibold tracking-snug whitespace-nowrap"
        >
          <span className="grid size-7 place-items-center rounded-control bg-primary text-primary-foreground">
            <Waypoints size={16} strokeWidth={1.75} />
          </span>
          <span>
            Intcom
            <small className="block text-xs leading-title font-medium text-muted">
              Service Desk
            </small>
          </span>
        </Link>
        <nav className="grid gap-0.5" aria-label="Main navigation">
          <span className="hidden px-2.5 pb-1.5 text-xs font-medium tracking-caps text-muted uppercase md:block">
            Workspace
          </span>
          <Link to="/" className={navItem} activeOptions={{ exact: true }}>
            <ChartColumn size={16} strokeWidth={1.75} />
            Insights
          </Link>
          <Link to="/tickets" className={navItem}>
            <Inbox size={16} strokeWidth={1.75} />
            Tickets
            <span className="ml-auto text-sm text-muted tabular-nums">{total - completed}</span>
          </Link>
        </nav>
        <div className="mt-auto hidden gap-3 border-t border-divider px-2.5 pt-3 pb-1 md:grid">
          <div className="grid gap-2">
            <div className="flex justify-between text-sm text-secondary">
              Reviewed
              <b className="font-medium text-foreground tabular-nums">
                {completed} / {total}
              </b>
            </div>
            <Meter value={completed / total} />
          </div>
          <div className={sourceLine}>
            <Dot tone={data.mock ? "warning" : "success"} />
            {data.mock ? "Mock proposals" : "Solver proposals"} · file only
          </div>
          <div
            className={sourceLine}
            title={premium.url ?? "Set VITE_PREMIUM_SOLVER_URL to enable a stronger model"}
          >
            <Dot tone={premium.online ? "success" : "muted"} />
            {premium.url
              ? premium.online
                ? `Premium · ${premium.model}`
                : "Premium solver offline"
              : "No premium solver"}
          </div>
        </div>
      </aside>
      <div className="mx-2 mt-0 mb-2 flex min-w-0 flex-col rounded-float border bg-shell md:my-2 md:mr-2 md:ml-0">
        <header className="flex h-auto flex-wrap items-center justify-between gap-4 border-b border-divider px-4 py-3 sm:h-14 sm:flex-nowrap sm:py-0 md:px-7">
          <nav
            className="flex min-w-0 items-center gap-2 text-base whitespace-nowrap text-muted"
            aria-label="Breadcrumb"
          >
            <span>Triage desk</span>
            <ChevronRight size={14} strokeWidth={1.75} />
            {onTickets ? (
              ticketId ? (
                <>
                  <Link
                    to="/tickets"
                    className="hover:text-foreground current:font-medium current:text-foreground"
                  >
                    Tickets
                  </Link>
                  <ChevronRight size={14} strokeWidth={1.75} />
                  <span aria-current="page" className="font-medium text-foreground">
                    {ticketId}
                  </span>
                </>
              ) : (
                <span aria-current="page" className="font-medium text-foreground">
                  Tickets
                </span>
              )
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                Insights
              </span>
            )}
          </nav>
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            {data.mock && (
              <MockBadge>
                <Dot tone="warning" />
                Mock data · proposals
              </MockBadge>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Reset all demo reviews?")) reset();
              }}
            >
              <RotateCcw size={16} strokeWidth={1.75} />
              Reset demo
            </Button>
            <Button variant="primary" onClick={exportData}>
              <Download size={16} strokeWidth={1.75} />
              Export JSON
            </Button>
          </div>
        </header>
        <main
          className={cn(
            "mx-auto w-full px-4 pt-4 pb-10 md:px-7 md:pt-7",
            ticketId ? "max-w-none" : "max-w-380",
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

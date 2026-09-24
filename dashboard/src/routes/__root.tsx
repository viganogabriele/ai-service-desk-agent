import { Link, Outlet, createRootRoute, useMatchRoute } from "@tanstack/react-router";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChartColumn, Undo2, X } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { TicketFiltersProvider, useTicketFilters } from "../components/tickets";
import type { TicketFilters } from "../components/tickets";
import { ThemeToggle } from "../components/theme";
import { TooltipLayer } from "../components/tooltip";
import logo from "../assets/logo.svg";
import diamond from "../assets/diamond.svg";
import rowsThree from "../assets/rows-three.svg";
import layoutKanban from "../assets/layout-kanban.svg";

export const Route = createRootRoute({ component: Root });

// The operator shown in the top bar. There is no sign-in yet; the desk has one reviewer.
const OPERATOR = { initials: "LC", name: "Lorenzo Corallo" };

const VIEWS: { view: TicketFilters["view"]; label: string; icon: string }[] = [
  { view: "priority", label: "Priority View", icon: diamond },
  { view: "table", label: "List View", icon: rowsThree },
  { view: "board", label: "Kanban View", icon: layoutKanban },
];

function Root() {
  return (
    <DashboardProvider>
      <TicketFiltersProvider>
        <Tooltip.Provider delayDuration={450} skipDelayDuration={400}>
          <Shell />
        </Tooltip.Provider>
      </TicketFiltersProvider>
    </DashboardProvider>
  );
}

function Shell() {
  const { filters, setFilters } = useTicketFilters();
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const onDetail = Boolean(matchRoute({ to: "/tickets/$ticketId" }));

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/tickets" className="brand" aria-label="TicketBuddy home">
          <img src={logo} alt="" width={32} height={32} />
          <span>TicketBuddy</span>
        </Link>
        <nav className="view-nav" aria-label="Ticket views">
          {VIEWS.map(({ view, label, icon }) => (
            <Link
              key={view}
              to="/tickets"
              search={{ view }}
              activeProps={{}}
              className={onTickets && filters.view === view ? "view-pill active" : "view-pill"}
              aria-current={onTickets && filters.view === view ? "page" : undefined}
              onClick={() =>
                setFilters({ view, status: view === "table" ? filters.status : "all" })
              }
            >
              <img src={icon} alt="" width={20} height={20} />
              <span className="label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="topbar-end">
          <Link
            to="/overview"
            className="icon-button"
            aria-label="Overview"
            data-tip="Overview"
            activeProps={{ className: "icon-button active" }}
          >
            <ChartColumn size={18} strokeWidth={1.75} />
          </Link>
          <ThemeToggle />
          <span
            className="user-avatar"
            role="img"
            aria-label={OPERATOR.name}
            data-tip={OPERATOR.name}
          >
            {OPERATOR.initials}
          </span>
        </div>
      </header>
      <main className={onDetail ? "main wide" : "main"}>
        <Outlet />
      </main>
      <Toast />
      <TooltipLayer />
    </div>
  );
}

function Toast() {
  const { notice, dismissNotice } = useDashboard();

  if (!notice) return null;

  return (
    <div className="toast" role="status">
      <span>{notice.message}</span>
      {notice.undo && (
        <button
          className="button ghost"
          onClick={() => {
            notice.undo?.();
            dismissNotice();
          }}
        >
          <Undo2 size={14} strokeWidth={1.75} />
          Undo
        </button>
      )}
      <button className="icon-button" aria-label="Dismiss" onClick={dismissNotice}>
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

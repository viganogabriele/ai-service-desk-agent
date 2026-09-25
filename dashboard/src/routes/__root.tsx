import { Link, Outlet, createRootRoute, useMatchRoute } from "@tanstack/react-router";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChartColumn, Gem, Rows3, SquareKanban, Undo2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { TicketFiltersProvider, useTicketFilters } from "../components/tickets";
import type { TicketFilters } from "../components/tickets";
import { ThemeToggle } from "../components/theme";
import { TooltipLayer } from "../components/tooltip";
import logo from "../assets/logo.svg";

export const Route = createRootRoute({ component: Root });

// The operator shown in the top bar. There is no sign-in yet; the desk has one reviewer.
const OPERATOR = { initials: "LC", name: "Lorenzo Corallo" };

const VIEWS: { view: TicketFilters["view"]; label: string; icon: LucideIcon }[] = [
  { view: "priority", label: "Priority", icon: Gem },
  { view: "table", label: "List", icon: Rows3 },
  { view: "board", label: "Kanban", icon: SquareKanban },
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
  const { filters } = useTicketFilters();
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
        <ViewSwitch active={onTickets ? filters.view : null} />
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

/**
 * One track, three equal segments and a thumb that slides to the active one. The stylesheet
 * places the thumb from `data-active`, so nothing is measured; off the ticket pages it fades out.
 */
function ViewSwitch({ active }: { active: TicketFilters["view"] | null }) {
  const { filters, setFilters } = useTicketFilters();

  return (
    <nav className="view-switch" aria-label="Ticket views" data-active={active ?? undefined}>
      <span className="view-thumb" aria-hidden="true" />
      {VIEWS.map(({ view, label, icon: Icon }) => (
        <Link
          key={view}
          to="/tickets"
          search={{ view }}
          activeProps={{}}
          className="view-option"
          aria-current={view === active ? "page" : undefined}
          aria-label={label}
          onClick={() => setFilters({ view, status: view === "table" ? filters.status : "all" })}
        >
          <Icon size={17} strokeWidth={1.9} />
          <span className="label">{label}</span>
        </Link>
      ))}
    </nav>
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

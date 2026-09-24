import { Link, Outlet, createRootRoute, useMatchRoute, useParams } from "@tanstack/react-router";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChartColumn, ChevronRight, Inbox, Undo2, Waypoints, X } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { TicketFiltersProvider, isOpen } from "../components/tickets";
import { ThemeToggle } from "../components/theme";
import { TooltipLayer } from "../components/tooltip";

export const Route = createRootRoute({ component: Root });

// Rich reason cards use Radix tooltips; their timing matches the shared `data-tip` layer.
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
  const { data, review, stronger } = useDashboard();
  const { ticketId } = useParams({ strict: false });
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const open = data.challenge.filter((_, index) => isOpen(review(index).status)).length;
  const model = data.proposals.find(Boolean)?.model_id;

  const strongerLabel = stronger.online
    ? `Stronger model · ${stronger.model ?? "online"}`
    : "Stronger model unavailable";

  return (
    <div className="app">
      {/* Icon-only rail on desktop; each label is a `data-tip` tooltip. */}
      <aside className="sidebar">
        <Link to="/" className="brand" data-tip="Intcom Service Desk">
          <span className="brand-mark">
            <Waypoints size={18} strokeWidth={1.75} />
          </span>
          <span className="brand-name">
            Intcom
            <small>Service Desk</small>
          </span>
        </Link>
        <nav className="nav-group" aria-label="Main navigation">
          <Link
            to="/"
            className="nav-item"
            aria-label="Overview"
            data-tip="Overview"
            activeOptions={{ exact: true }}
            activeProps={{ className: "active" }}
          >
            <ChartColumn size={18} strokeWidth={1.75} />
          </Link>
          <Link
            to="/tickets"
            className="nav-item"
            aria-label={`Tickets, ${open} open`}
            data-tip={`Tickets · ${open} open`}
            activeProps={{ className: "active" }}
          >
            <Inbox size={18} strokeWidth={1.75} />
            {open > 0 && (
              <span className="nav-count num" aria-hidden="true">
                {open}
              </span>
            )}
          </Link>
        </nav>
        {/* The header is hidden on phones, so the sidebar carries the toggle there. */}
        <ThemeToggle className="sidebar-theme" />
        {(model || stronger.configured) && (
          <div className="sidebar-foot">
            {model && (
              <div
                className="source-line"
                role="img"
                aria-label={`AI suggestions by ${model}`}
                data-tip={`AI suggestions · ${model}`}
                tabIndex={0}
              >
                <i className="dot green" />
              </div>
            )}
            {stronger.configured && (
              <div
                className="source-line"
                role="img"
                aria-label={strongerLabel}
                data-tip={strongerLabel}
                tabIndex={0}
              >
                <i className={`dot ${stronger.online ? "green" : "amber"}`} />
              </div>
            )}
          </div>
        )}
      </aside>
      <div className="shell">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            {onTickets ? (
              ticketId ? (
                <>
                  <Link to="/tickets">Tickets</Link>
                  <ChevronRight size={14} strokeWidth={1.75} />
                  <span aria-current="page">{ticketId}</span>
                </>
              ) : (
                <span aria-current="page">Tickets</span>
              )
            ) : (
              <span aria-current="page">Overview</span>
            )}
          </nav>
          <div className="header-actions">
            <ThemeToggle />
          </div>
        </header>
        <main className={ticketId ? "main wide" : "main"}>
          <Outlet />
        </main>
      </div>
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

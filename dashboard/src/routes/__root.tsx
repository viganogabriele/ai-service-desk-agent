import { Link, Outlet, createRootRoute, useMatchRoute, useParams } from "@tanstack/react-router";
import { ChartColumn, ChevronRight, Inbox, Undo2, Waypoints, X } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { TicketFiltersProvider, isOpen } from "../components/tickets";

export const Route = createRootRoute({ component: Root });

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
  const { data, review, stronger } = useDashboard();
  const { ticketId } = useParams({ strict: false });
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const open = data.challenge.filter((_, index) => isOpen(review(index).status)).length;
  const model = data.proposals.find(Boolean)?.model_id;

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Waypoints size={16} strokeWidth={1.75} />
          </span>
          <span>
            Intcom
            <small>Service Desk</small>
          </span>
        </Link>
        <nav className="nav-group" aria-label="Main navigation">
          <Link
            to="/"
            className="nav-item"
            activeOptions={{ exact: true }}
            activeProps={{ className: "active" }}
          >
            <ChartColumn size={16} strokeWidth={1.75} />
            Overview
          </Link>
          <Link to="/tickets" className="nav-item" activeProps={{ className: "active" }}>
            <Inbox size={16} strokeWidth={1.75} />
            Tickets
            {open > 0 && <span className="nav-count num">{open}</span>}
          </Link>
        </nav>
        {(model || stronger.configured) && (
          <div className="sidebar-foot">
            {model && (
              <div className="source-line" title="Model that produced the triage suggestions">
                <i className="dot green" />
                <span>
                  AI suggestions
                  <small>{model}</small>
                </span>
              </div>
            )}
            {stronger.configured && (
              <div className="source-line">
                <i className={`dot ${stronger.online ? "green" : "amber"}`} />
                <span>
                  Stronger model
                  <small>{stronger.online ? stronger.model : "Unavailable"}</small>
                </span>
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
        </header>
        <main className={ticketId ? "main wide" : "main"}>
          <Outlet />
        </main>
      </div>
      <Toast />
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

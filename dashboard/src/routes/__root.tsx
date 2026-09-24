import { Link, Outlet, createRootRoute, useMatchRoute, useParams } from "@tanstack/react-router";
import { ChartColumn, ChevronRight, Download, Inbox, RotateCcw, Waypoints } from "lucide-react";
import { DashboardProvider, useDashboard } from "../state";
import { COMPLETED_STATUSES } from "../domain";
import { TicketFiltersProvider } from "../components/tickets";

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
  const { data, review, reset, exportData, premium } = useDashboard();
  const { ticketId } = useParams({ strict: false });
  const matchRoute = useMatchRoute();
  const onTickets = Boolean(matchRoute({ to: "/tickets", fuzzy: true }));
  const total = data.challenge.length;

  const completed = data.challenge.filter((_, index) =>
    COMPLETED_STATUSES.includes(review(index).status),
  ).length;

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
          <span className="nav-label">Workspace</span>
          <Link
            to="/"
            className="nav-item"
            activeOptions={{ exact: true }}
            activeProps={{ className: "active" }}
          >
            <ChartColumn size={16} strokeWidth={1.75} />
            Insights
          </Link>
          <Link to="/tickets" className="nav-item" activeProps={{ className: "active" }}>
            <Inbox size={16} strokeWidth={1.75} />
            Tickets
            <span className="nav-count num">{total - completed}</span>
          </Link>
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-stat">
            <div>
              Reviewed
              <b className="num">
                {completed} / {total}
              </b>
            </div>
            <div className="meter">
              <span style={{ width: `${(completed / total) * 100}%` }} />
            </div>
          </div>
          <div className="source-line">
            <i className={`dot ${data.mock ? "amber" : "green"}`} />
            {data.mock ? "Mock proposals" : "Solver proposals"} · file only
          </div>
          <div
            className="source-line"
            title={premium.url ?? "Set VITE_PREMIUM_SOLVER_URL to enable a stronger model"}
          >
            <i className={`dot ${premium.online ? "green" : ""}`} />
            {premium.url
              ? premium.online
                ? `Premium · ${premium.model}`
                : "Premium solver offline"
              : "No premium solver"}
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>Triage desk</span>
            <ChevronRight size={14} strokeWidth={1.75} />
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
              <span aria-current="page">Insights</span>
            )}
          </nav>
          <div className="header-actions">
            {data.mock && (
              <span className="mock-badge">
                <i className="dot amber" />
                Mock data · proposals
              </span>
            )}
            <button
              className="button ghost"
              onClick={() => {
                if (window.confirm("Reset all demo reviews?")) reset();
              }}
            >
              <RotateCcw size={16} strokeWidth={1.75} />
              Reset demo
            </button>
            <button className="button primary" onClick={exportData}>
              <Download size={16} strokeWidth={1.75} />
              Export JSON
            </button>
          </div>
        </header>
        <main className={ticketId ? "main wide" : "main"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { DashboardProvider, useDashboard } from "../state";

export const Route = createRootRoute({ component: Root });

function Root() {
  return (
    <DashboardProvider>
      <Shell />
    </DashboardProvider>
  );
}

function Shell() {
  const { data, reset, exportData } = useDashboard();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">✦</span> Intcom <strong>Service Desk</strong>
        </Link>
        <div className="header-actions">
          {data.mock && <span className="mock-badge">MOCK DATA · PROPOSALS</span>}
          <button
            className="button subtle"
            onClick={() => {
              if (window.confirm("Reset all demo reviews?")) reset();
            }}
          >
            Reset demo
          </button>
          <button className="button primary" onClick={exportData}>
            Export JSON ↓
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Main navigation">
        <Link to="/" activeProps={{ className: "active" }}>
          Overview & queue
        </Link>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

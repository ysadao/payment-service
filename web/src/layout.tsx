import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";

const links = [
  { to: "/", label: "Overview", end: true },
  { to: "/payments", label: "Payments" },
  { to: "/customers", label: "Customers" },
  { to: "/ledger", label: "Ledger" },
  { to: "/sessions", label: "Sessions" },
];

export function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <span className="mark" />
          Ledger
        </div>
        <p className="nav-label">Operations</p>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            {l.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="who">
          <strong>Operator</strong>
          <span>{user?.email}</span>
          <button className="ghost" type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

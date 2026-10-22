import { NavLink } from "react-router-dom";

export default function Navbar({ alertCount = 0, user, onSignOut }) {
  const links = [
    { to: "/", label: "Dashboard", end: true },
    { to: "/files", label: "My files" },
    { to: "/verify", label: "Verify a file" },
    { to: "/history", label: "History & alerts", badge: alertCount },
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-brand">
        <span aria-hidden="true">&#9670;</span> FileGuard
      </div>

      {links.map(({ to, label, badge, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          {label}
          {badge > 0 && <span className="nav-badge">{badge}</span>}
        </NavLink>
      ))}

      <div className="nav-user">
        <strong>{user?.name}</strong>
        <small>{user?.email}<br />{user?.role === "admin" ? "Administrator" : "User"}</small>
        <button type="button" className="nav-logout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <button type="button" className="nav-logout nav-logout-mobile" onClick={onSignOut}>
        Sign out
      </button>
    </nav>
  );
}
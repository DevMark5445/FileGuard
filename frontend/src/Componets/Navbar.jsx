export default function Navbar({ alertCount = 0 }) {
  const links = [
    { href: '#', label: 'Dashboard' },
    { href: '#files', label: 'My files' },
    { href: '#verify', label: 'Verify a file' },
    { href: '#history', label: 'History & alerts', badge: alertCount },
    { href: '#admin', label: 'Admin' },
  ];

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-brand">
        <span aria-hidden="true">&#9670;</span> FileGuard
      </div>

      {links.map(({ href, label, badge }) => (
        <a key={href} href={href} className="nav-link">
          {label}
          {badge > 0 && <span className="nav-badge">{badge}</span>}
        </a>
      ))}

      <div className="nav-user">
        <strong>Demo User</strong>
        <small>
          <br />
          demo@fileguard.io
          <br />
          Administrator
        </small>
        <button type="button" className="nav-logout">
          Sign out
        </button>
      </div>
    </nav>
  );
}
export function PageHead({ title, sub }) {
  return (
    <header className="page-head">
      <h2 className="pt">{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </header>
  );
}

export function Panel({ title, children }) {
  return (
    <section className="panel">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ErrorText({ children }) {
  return <p className="err" role="alert">{children}</p>;
}

export function FormError({ children }) {
  return <p className="err" role="alert">{children}</p>;
}

export function Spinner() {
  return <div className="empty" role="status">Loading…</div>;
}

export function Button({ children, ...props }) {
  return (
    <button
      type="button"
      className="btn"
      {...props}
    >
      {children}
    </button>
  );
}

export function SmallBtn({ children, ...props }) {
  return (
    <button
      type="button"
      className="btn ghost sm"
      {...props}
    >
      {children}
    </button>
  );
}

export function Table({ head, children }) {
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>{head.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }) {
  return <td className={className}>{children}</td>;
}

export function Stat({ n, label, tone = "" }) {
  const status = tone.includes("bad") ? " bad" : tone.includes("ok") ? " good" : "";
  return (
    <div className={`stat${status}`}>
      <div className="n">{n}</div>
      {label}
    </div>
  );
}

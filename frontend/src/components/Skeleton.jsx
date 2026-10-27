function SkeletonBlock({ className = "" }) {
  return <span aria-hidden="true" className={`skeleton-block ${className}`} />;
}

export function PageSkeleton() {
  return (
    <section className="skeleton-page" role="status" aria-label="Loading page" aria-busy="true">
      <header className="skeleton-page-head">
        <SkeletonBlock className="skeleton-title" />
        <SkeletonBlock className="skeleton-subtitle" />
      </header>
      <div className="skeleton-stats">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton-stat" key={index}>
            <SkeletonBlock className="skeleton-number" />
            <SkeletonBlock className="skeleton-label" />
          </div>
        ))}
      </div>
      <section className="skeleton-panel">
        <SkeletonBlock className="skeleton-panel-title" />
        <div className="skeleton-table-head">
          {Array.from({ length: 4 }, (_, index) => <SkeletonBlock className="skeleton-cell" key={index} />)}
        </div>
        {Array.from({ length: 5 }, (_, row) => (
          <div className="skeleton-table-row" key={row}>
            {Array.from({ length: 4 }, (_, cell) => (
              <SkeletonBlock className={`skeleton-cell skeleton-cell-${cell + 1}`} key={cell} />
            ))}
          </div>
        ))}
      </section>
    </section>
  );
}

export function AppSkeleton() {
  return (
    <div className="app-shell skeleton-app" aria-label="Loading FileGuard" aria-busy="true">
      <aside className="skeleton-nav">
        <SkeletonBlock className="skeleton-brand" />
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock className="skeleton-nav-item" key={index} />
        ))}
        <SkeletonBlock className="skeleton-profile" />
      </aside>
      <main className="app-main">
        <PageSkeleton />
      </main>
      <span className="skeleton-live" role="status">Loading FileGuard…</span>
    </div>
  );
}

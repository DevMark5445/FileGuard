import { Fragment, useCallback, useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { Empty, ErrorText, FormError, PageHead, Panel, SmallBtn, Spinner, Stat, Table, Td } from "../components/UI.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { fmtDate } from "../utils.js";

const sections = [
  ["overview", "Overview"],
  ["users", "Users & admins"],
  ["files", "Registered files"],
  ["alerts", "Security alerts"],
  ["activity", "Activity log"],
  ["incidents", "Incidents"],
  ["settings", "System settings"],
  ["reports", "Reports"],
];
const PAGE_SIZE = 100;

const emptyStats = {
  totalUsers: 0,
  activeUsers: 0,
  admins: 0,
  superadmins: 0,
  totalFiles: 0,
  modifiedFiles: 0,
  verified: 0,
  modified: 0,
  openIncidents: 0,
};

function eventLabel(event) {
  return event.replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusPill(status) {
  const tone = ["active", "intact", "resolved"].includes(status) ? "ok"
    : ["suspended", "deactivated", "modified", "critical", "high"].includes(status) ? "bad" : "n";
  return <span className={`pill ${tone}`}>{status}</span>;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function Overview({ stats, activity, onOpen }) {
  return (
    <>
      <div className="stats">
        <Stat n={stats.totalUsers} label="Registered users" />
        <Stat n={stats.activeUsers} label="Active accounts" tone="ok" />
        <Stat n={stats.admins} label="Administrators" />
        <Stat n={stats.totalFiles} label="Monitored files" />
        <Stat n={stats.verified} label="Successful checks" tone="ok" />
        <Stat n={stats.modified} label="Detected changes" tone={stats.modified ? "bad" : ""} />
        <Stat n={stats.openIncidents} label="Open incidents" tone={stats.openIncidents ? "bad" : ""} />
      </div>
      <Panel title="Recent system activity">
        {!activity.length ? <Empty>No activity has been recorded yet.</Empty> : (
          <Table head={["Activity", "Account", "When", "Severity"]}>
            {activity.map((item) => (
              <tr key={item.id}>
                <Td>{eventLabel(item.event)}</Td>
                <Td>{item.actorName}</Td>
                <Td>{fmtDate(item.date)}</Td>
                <Td>{statusPill(item.severity)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <div className="row dashboard-actions">
        <button className="btn ghost" onClick={() => onOpen("users")}>Manage accounts</button>
        <button className="btn ghost" onClick={() => onOpen("alerts")}>Review security alerts</button>
        <button className="btn ghost" onClick={() => onOpen("incidents")}>Track incidents</button>
      </div>
    </>
  );
}

function Pagination({ total, skip, onPage }) {
  if (total <= PAGE_SIZE) return null;
  const first = skip + 1;
  const last = Math.min(skip + PAGE_SIZE, total);
  return (
    <div className="admin-pagination">
      <span className="hs">Showing {first}–{last} of {total}</span>
      <button className="btn ghost sm" disabled={skip === 0} onClick={() => onPage(Math.max(0, skip - PAGE_SIZE))}>Previous</button>
      <button className="btn ghost sm" disabled={skip + PAGE_SIZE >= total} onClick={() => onPage(skip + PAGE_SIZE)}>Next</button>
    </div>
  );
}

function Users({ users, total, skip, onPage, query, onSearch, busy, onAction, onCreateAdmin, onDetails, onResetAccess }) {
  const [search, setSearch] = useState(query);
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "", password: "" });
  const [details, setDetails] = useState({});

  return (
    <>
      <Panel title="Create administrator">
        <p className="sub">Administrator accounts can be created only by you. New admins receive the standard admin role, never super-admin privileges.</p>
        <form className="admin-form-grid" onSubmit={(event) => {
          event.preventDefault();
          onCreateAdmin(newAdmin).then((success) => {
            if (success) setNewAdmin({ name: "", email: "", password: "" });
          });
        }}>
          <label>Name<input required maxLength="100" value={newAdmin.name} onChange={(event) => setNewAdmin({ ...newAdmin, name: event.target.value })} /></label>
          <label>Email<input required type="email" value={newAdmin.email} onChange={(event) => setNewAdmin({ ...newAdmin, email: event.target.value })} /></label>
          <label>Temporary password<input required type="password" minLength="8" value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} /></label>
          <button type="submit" className="btn" disabled={busy}>Create admin</button>
        </form>
      </Panel>
      <Panel title="All accounts">
        <form className="admin-search" onSubmit={(event) => { event.preventDefault(); onSearch(search); }}>
          <label>Search accounts<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" /></label>
          <button className="btn ghost sm">Search</button>
        </form>
        {!users.length ? <Empty>No accounts match your search.</Empty> : (
          <Table head={["Account", "Role", "Status", "Joined", "Manage"]}>
            {users.map((user) => (
              <Fragment key={user.id}>
                <tr>
                  <Td><strong>{user.name}</strong><br /><span className="hs">{user.email}</span></Td>
                  <Td>{statusPill(user.role)}</Td>
                  <Td>{statusPill(user.status || "active")}</Td>
                  <Td>{fmtDate(user.created)}</Td>
                  <Td>
                    <div className="admin-actions">
                      <SmallBtn disabled={busy} onClick={async () => {
                        if (details[user.id]) {
                          setDetails({ ...details, [user.id]: null });
                        } else {
                          const detail = await onDetails(user.id);
                          setDetails({ ...details, [user.id]: detail });
                        }
                      }}>Details</SmallBtn>
                      {user.role !== "superadmin" && <>
                        <SmallBtn disabled={busy} onClick={() => onAction("role", user, { role: user.role === "admin" ? "user" : "admin" })}>
                          {user.role === "admin" ? "Remove admin" : "Promote"}
                        </SmallBtn>
                        {user.status === "active" ? <>
                          <SmallBtn disabled={busy} onClick={() => onAction("status", user, { status: "deactivated" })}>Deactivate</SmallBtn>
                          <SmallBtn disabled={busy} onClick={() => onAction("status", user, { status: "suspended" })}>Suspend</SmallBtn>
                        </> : <>
                          <SmallBtn disabled={busy} onClick={() => onAction("status", user, { status: "active" })}>Activate</SmallBtn>
                          <SmallBtn disabled={busy} onClick={() => onAction("status", user, { status: user.status === "suspended" ? "deactivated" : "suspended" })}>
                            {user.status === "suspended" ? "Deactivate" : "Suspend"}
                          </SmallBtn>
                        </>}
                        {user.role === "admin" && user.status === "active" && <SmallBtn disabled={busy} onClick={() => onResetAccess(user)}>Send recovery link</SmallBtn>}
                        <SmallBtn disabled={busy} onClick={() => onAction("delete", user)}>Delete</SmallBtn>
                      </>}
                    </div>
                  </Td>
                </tr>
                {details[user.id] && <tr><Td colSpan="5">
                  <div className="account-details">
                    <p><strong>Account ID:</strong> <span className="mono">{details[user.id].user.id}</span></p>
                    <p><strong>Files registered:</strong> {details[user.id].fileCount}</p>
                    <p><strong>Last updated:</strong> {fmtDate(details[user.id].user.lastUpdated)}</p>
                    <strong>Recent account activity</strong>
                    {details[user.id].recentActivity.length
                      ? <ul>{details[user.id].recentActivity.map((item) => <li key={item.id}>{eventLabel(item.event)} · {fmtDate(item.date)}</li>)}</ul>
                      : <p className="hs">No recent activity.</p>}
                  </div>
                </Td></tr>}
              </Fragment>
            ))}
          </Table>
        )}
        <Pagination total={total} skip={skip} onPage={onPage} />
      </Panel>
    </>
  );
}

function RegisteredFiles({ files, total, skip, onPage }) {
  return (
    <Panel title={`System-wide file metadata (${files.length})`}>
      <p className="sub">Files stay on their owners’ devices. This view contains only names, sizes, fingerprints, ownership, and verification status.</p>
      {!files.length ? <Empty>No registered files yet.</Empty> : (
        <Table head={["File", "Owner", "Size", "Registered", "Latest check", "File ID", "Fingerprint"]}>
          {files.map((file) => (
            <tr key={file.id}>
              <Td><strong>{file.name}</strong></Td>
              <Td>{file.owner?.name || "Deleted account"}<br /><span className="hs">{file.owner?.email}</span></Td>
              <Td>{formatBytes(file.size)}</Td>
              <Td>{fmtDate(file.date)}</Td>
              <Td>{statusPill(file.latestStatus || "registered")}<br /><span className="hs">{file.verificationCount} checks</span></Td>
              <Td><span className="mono admin-hash">{file.id}</span></Td>
              <Td><span className="mono admin-hash" title={file.hash}>{file.hash}</span></Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination total={total} skip={skip} onPage={onPage} />
    </Panel>
  );
}

function ActivityTable({ activity, total, skip, onPage }) {
  return !activity.length ? <Empty>No matching system activity was found.</Empty> : (
    <>
    <Table head={["Event", "Account", "Details", "IP", "When"]}>
      {activity.map((item) => (
        <tr key={item.id}>
          <Td>{eventLabel(item.event)}<br />{statusPill(item.severity)}</Td>
          <Td>{item.actorName}<br /><span className="hs">{item.actorEmail}</span></Td>
          <Td>{item.details?.fileName || item.details?.title || item.details?.status || item.details?.reason || "—"}</Td>
          <Td className="mono">{item.ip || "—"}</Td>
          <Td>{fmtDate(item.date)}</Td>
        </tr>
      ))}
    </Table>
    <Pagination total={total} skip={skip} onPage={onPage} />
    </>
  );
}

function Incidents({ incidents, busy, onCreate, onUpdate }) {
  const [draft, setDraft] = useState({ title: "", description: "", severity: "medium", affectedUsers: "", affectedFiles: "" });
  const [notes, setNotes] = useState({});
  return (
    <>
      <Panel title="Record a security incident">
        <form className="incident-form" onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            ...draft,
            affectedUsers: draft.affectedUsers.split(",").map((id) => id.trim()).filter(Boolean),
            affectedFiles: draft.affectedFiles.split(",").map((id) => id.trim()).filter(Boolean),
          }).then((success) => {
            if (success) setDraft({ title: "", description: "", severity: "medium", affectedUsers: "", affectedFiles: "" });
          });
        }}>
          <label>Incident title<input required maxLength="160" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Description<textarea required maxLength="4000" rows="3" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}>
            {["low", "medium", "high", "critical"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
          <label>Affected account IDs (comma separated)<input value={draft.affectedUsers} onChange={(event) => setDraft({ ...draft, affectedUsers: event.target.value })} /></label>
          <label>Affected file IDs (comma separated)<input value={draft.affectedFiles} onChange={(event) => setDraft({ ...draft, affectedFiles: event.target.value })} /></label>
          <button className="btn" disabled={busy}>Create incident</button>
        </form>
      </Panel>
      <Panel title="Incident tracker">
        {!incidents.length ? <Empty>No security incidents have been recorded.</Empty> : incidents.map((incident) => (
          <article className="incident-card" key={incident._id}>
            <div className="incident-title">
              <div><h4>{incident.title}</h4><p>{incident.description}</p></div>
              <div>{statusPill(incident.severity)} {statusPill(incident.status)}</div>
            </div>
            <p className="hs">Opened by {incident.createdBy?.name || "Unknown"} · {fmtDate(incident.createdAt)}</p>
            {(incident.affectedUsers?.length > 0 || incident.affectedFiles?.length > 0) && (
              <p className="hs">Affected accounts: {incident.affectedUsers.map((user) => `${user.name} (${user.email})`).join(", ") || "none"} · Files: {incident.affectedFiles.map((file) => file.name).join(", ") || "none"}</p>
            )}
            {incident.notes?.map((note) => <p className="incident-note" key={note._id}>{note.text} <span className="hs">— {note.author?.name || "Admin"}, {fmtDate(note.createdAt)}</span></p>)}
            {incident.status !== "resolved" && (
              <form className="incident-update" onSubmit={(event) => {
                event.preventDefault();
                const note = notes[incident._id] || "";
                const status = incident.status === "open" ? "investigating" : "resolved";
                onUpdate(incident._id, { status, ...(note.trim() ? { note } : {}) }).then(() => setNotes({ ...notes, [incident._id]: "" }));
              }}>
                <input value={notes[incident._id] || ""} maxLength="2000" placeholder="Investigation note (optional)" onChange={(event) => setNotes({ ...notes, [incident._id]: event.target.value })} />
                <button className="btn ghost" disabled={busy}>{incident.status === "open" ? "Start investigation" : "Resolve incident"}</button>
              </form>
            )}
          </article>
        ))}
      </Panel>
    </>
  );
}

function Settings({ settings, busy, onSave }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (settings) setDraft({
      permittedFileTypes: settings.permittedFileTypes.join(", "),
      maximumFileSize: settings.maximumFileSize,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      securityNotifications: settings.securityNotifications,
      minimumPasswordLength: settings.minimumPasswordLength,
      passwordRequiresLetterAndNumber: settings.passwordRequiresLetterAndNumber,
    });
  }, [settings]);

  if (!draft) return <Spinner />;
  return (
    <Panel title="System-wide security and account policies">
      <p className="sub">Changes are validated by the server and recorded in the system activity log.</p>
      <form className="admin-settings-grid" onSubmit={(event) => {
        event.preventDefault();
        const permittedFileTypes = draft.permittedFileTypes.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        onSave({ ...draft, permittedFileTypes, maximumFileSize: Number(draft.maximumFileSize), sessionTimeoutMinutes: Number(draft.sessionTimeoutMinutes), minimumPasswordLength: Number(draft.minimumPasswordLength) });
      }}>
        <label>Permitted extensions (comma separated; * allows all)<input value={draft.permittedFileTypes} onChange={(event) => setDraft({ ...draft, permittedFileTypes: event.target.value })} /></label>
        <label>Maximum file size (bytes)<input type="number" min="1" max={1024 ** 3} value={draft.maximumFileSize} onChange={(event) => setDraft({ ...draft, maximumFileSize: event.target.value })} /></label>
        <label>Session timeout (minutes)<input type="number" min="5" max={30 * 24 * 60} value={draft.sessionTimeoutMinutes} onChange={(event) => setDraft({ ...draft, sessionTimeoutMinutes: event.target.value })} /></label>
        <label>Minimum password length<input type="number" min="8" max="128" value={draft.minimumPasswordLength} onChange={(event) => setDraft({ ...draft, minimumPasswordLength: event.target.value })} /></label>
        <label className="admin-check"><input type="checkbox" checked={draft.securityNotifications} onChange={(event) => setDraft({ ...draft, securityNotifications: event.target.checked })} /> Enable security notifications</label>
        <label className="admin-check"><input type="checkbox" checked={draft.passwordRequiresLetterAndNumber} onChange={(event) => setDraft({ ...draft, passwordRequiresLetterAndNumber: event.target.checked })} /> Require a letter and a number in passwords</label>
        <p className="hs">Email notifications require the optional SMTP configuration. Alerts are always retained in the dashboard and audit log.</p>
        <button className="btn" disabled={busy}>Save system settings</button>
      </form>
    </Panel>
  );
}

function MfaControl() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setStatus(await adminApi.get("/mfa"));
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load MFA status."));
  }, [refresh]);

  const run = async (operation, success) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      toast(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update MFA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Super-admin multi-factor authentication">
      {status?.enabled ? (
        <>
          <p>{statusPill("active")} Authenticator verification is required when you sign in.</p>
          {recoveryCodes.length > 0 && (
            <div className="result">
              <strong>Save these one-time recovery codes now.</strong>
              <p>Each code works once. They are shown only during setup and cannot be retrieved later.</p>
              <p className="mono admin-recovery-codes">{recoveryCodes.join("\n")}</p>
              <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(
                () => toast("Recovery codes copied"),
                () => setError("Copy is not available in this browser.")
              )}>Copy recovery codes</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p>Enable an authenticator app for an additional sign-in factor on the super-admin account.</p>
          {secret ? (
            <>
              <p>Manually add this secret to your authenticator app, then enter its current six-digit code to confirm setup.</p>
              <p className="mono admin-mfa-secret">{secret}</p>
              <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
              <button className="btn" disabled={busy} onClick={() => run(async () => {
                const result = await adminApi.mutate("/mfa/enable", "POST", { code });
                setSecret("");
                setCode("");
                setRecoveryCodes(result.recoveryCodes || []);
              }, "Multi-factor authentication enabled.")}>Confirm MFA setup</button>
            </>
          ) : (
            <button className="btn" disabled={busy || !status} onClick={() => run(async () => {
              const result = await adminApi.mutate("/mfa/setup", "POST");
              setSecret(result.secret);
            }, "Authenticator setup started.")}>Set up authenticator</button>
          )}
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Panel>
  );
}

function Reports({ busy, onDownload }) {
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <Panel title="System report">
      <p>Export account registrations, monitored files, verification results, security incidents, and administrator actions for a selected period.</p>
      <div className="report-period">
        <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="btn" onClick={() => onDownload({ from, to })} disabled={busy || !from || !to}>Download CSV report</button>
      </div>
    </Panel>
  );
}

export default function SuperAdmin() {
  const toast = useToast();
  const [section, setSection] = useState("overview");
  const [stats, setStats] = useState(emptyStats);
  const [recentActivity, setRecentActivity] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSkip, setUserSkip] = useState(0);
  const [userQuery, setUserQuery] = useState("");
  const [files, setFiles] = useState([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [fileSkip, setFileSkip] = useState(0);
  const [activity, setActivity] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activitySkip, setActivitySkip] = useState(0);
  const [alertSkip, setAlertSkip] = useState(0);
  const [incidents, setIncidents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    const response = await adminApi.get("/overview");
    setStats(response.stats);
    setRecentActivity(response.recentActivity);
  }, []);

  const loadSection = useCallback(async () => {
    if (section === "overview" || section === "reports") return;
    if (section === "users") {
      const { users: records, total } = await adminApi.get(`/users?limit=${PAGE_SIZE}&skip=${userSkip}&query=${encodeURIComponent(userQuery)}`);
      setUsers(records);
      setUsersTotal(total);
    }
    if (section === "files") {
      const { files: records, total } = await adminApi.get(`/files?limit=${PAGE_SIZE}&skip=${fileSkip}`);
      setFiles(records);
      setFilesTotal(total);
    }
    if (section === "alerts") {
      const { activity: events, total } = await adminApi.get(`/activity?limit=${PAGE_SIZE}&skip=${alertSkip}&severity=alerts`);
      setActivity(events);
      setActivityTotal(total);
    }
    if (section === "activity") {
      const { activity: events, total } = await adminApi.get(`/activity?limit=${PAGE_SIZE}&skip=${activitySkip}`);
      setActivity(events);
      setActivityTotal(total);
    }
    if (section === "incidents") setIncidents((await adminApi.get("/incidents")).incidents);
    if (section === "settings") setSettings((await adminApi.get("/settings")).settings);
  }, [section, userSkip, userQuery, fileSkip, activitySkip, alertSkip]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([loadOverview(), loadSection()])
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load administration data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadOverview, loadSection]);

  const refresh = async () => {
    await Promise.all([loadOverview(), loadSection()]);
  };

  const perform = async (operation, successMessage) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      toast(successMessage);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The administration action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeUser = (action, user, data) => {
    if (action === "delete" && !window.confirm(`Permanently delete ${user.name}, their registered file metadata, and redact their activity records?`)) {
      return Promise.resolve();
    }
    const path = `/users/${encodeURIComponent(user.id)}`;
    if (action === "role") return perform(() => adminApi.mutate(`${path}/role`, "PATCH", data), "Account role updated.");
    if (action === "status") return perform(() => adminApi.mutate(`${path}/status`, "PATCH", data), `Account ${data.status}.`);
    return perform(() => adminApi.mutate(path, "DELETE"), "Account deleted.");
  };

  const createAdmin = (data) => perform(() => adminApi.createAdmin(data), "Administrator account created.");
  const getUserDetails = async (id) => {
    try {
      return await adminApi.get(`/users/${encodeURIComponent(id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load account details.");
      return null;
    }
  };
  const resetAdminAccess = (user) => {
    if (!window.confirm(`Send a secure password-recovery link to ${user.email}?`)) return;
    return perform(() => adminApi.mutate(`/users/${encodeURIComponent(user.id)}/reset-access`, "POST"), "Recovery link sent.");
  };
  const createIncident = (data) => perform(() => adminApi.mutate("/incidents", "POST", data), "Incident recorded.");
  const updateIncident = (id, data) => perform(() => adminApi.mutate(`/incidents/${encodeURIComponent(id)}`, "PATCH", data), "Incident updated.");
  const saveSettings = (data) => perform(async () => {
    const result = await adminApi.mutate("/settings", "PUT", data);
    setSettings(result.settings);
  }, "System settings saved and logged.");
  const downloadReport = (filters) => perform(async () => {
    const blob = await adminApi.downloadReport(filters);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fileguard-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, "Report downloaded.");

  return (
    <>
      <PageHead title="Super Admin Control Center" sub="System-wide account management, integrity monitoring, security activity, and policy controls." />
      <div className="admin-layout">
        <nav className="admin-tabs" aria-label="Super admin sections">
          {sections.map(([key, label]) => (
            <button type="button" className={section === key ? "selected" : ""} key={key} onClick={() => setSection(key)}>{label}</button>
          ))}
        </nav>
        <main className="admin-content">
          {error && <ErrorText>{error}</ErrorText>}
          {loading ? <Spinner /> : (
            <>
              {section === "overview" && <Overview stats={stats} activity={recentActivity} onOpen={setSection} />}
              {section === "users" && <Users users={users} total={usersTotal} skip={userSkip} onPage={setUserSkip} query={userQuery} onSearch={(query) => { setUserQuery(query); setUserSkip(0); }} busy={busy} onAction={changeUser} onCreateAdmin={createAdmin} onDetails={getUserDetails} onResetAccess={resetAdminAccess} />}
              {section === "files" && <RegisteredFiles files={files} total={filesTotal} skip={fileSkip} onPage={setFileSkip} />}
              {section === "alerts" && <Panel title="Security alerts"><p className="sub">A hash mismatch records a changed file; it does not, by itself, prove an attack.</p><ActivityTable activity={activity} total={activityTotal} skip={alertSkip} onPage={setAlertSkip} /></Panel>}
              {section === "activity" && <Panel title="System activity log"><ActivityTable activity={activity} total={activityTotal} skip={activitySkip} onPage={setActivitySkip} /></Panel>}
              {section === "incidents" && <Incidents incidents={incidents} busy={busy} onCreate={createIncident} onUpdate={updateIncident} />}
              {section === "settings" && <><Settings settings={settings} busy={busy} onSave={saveSettings} /><MfaControl /></>}
              {section === "reports" && <Reports busy={busy} onDownload={downloadReport} />}
            </>
          )}
        </main>
      </div>
    </>
  );
}

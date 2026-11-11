import { Fragment, useCallback, useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { profileApi } from "../auth.js";
import { Empty, ErrorText, PageHead, Panel, SmallBtn, Spinner, Stat, Table, Td } from "../components/UI.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { fmtDate } from "../utils.js";
import FileDiff from "../components/FileDiff.jsx";

const PAGE_SIZE = 50;
const sections = [
  ["overview", "Dashboard"],
  ["users", "User Management"],
  ["files", "File Monitoring"],
  ["verify", "File Verification"],
  ["scans", "File Scan History"],
  ["alerts", "Security Alerts"],
  ["history", "Verification History"],
  ["activity", "Activity Logs"],
  ["reports", "Reports"],
  ["notifications", "Notifications"],
  ["profile", "My Profile"],
];

const defaultStats = { totalUsers: 0, totalFiles: 0, modifiedFiles: 0, flaggedFiles: 0, verified: 0, modified: 0, openIncidents: 0 };

function eventLabel(event = "") {
  return event.replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Status({ value }) {
  const tone = ["active", "intact", "resolved", "healthy", "clean", "valid", "matched"].includes(value) ? "ok"
    : ["suspended", "deactivated", "modified", "malicious", "high", "corrupted", "infected", "invalid"].includes(value) ? "bad" : "n";
  return <span className={`pill ${tone}`}>{(value || "open").replaceAll("_", " ")}</span>;
}

function Pagination({ total, skip, onChange }) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="admin-pagination">
      <span className="hs">Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}</span>
      <button className="btn ghost sm" disabled={skip === 0} onClick={() => onChange(Math.max(skip - PAGE_SIZE, 0))}>Previous</button>
      <button className="btn ghost sm" disabled={skip + PAGE_SIZE >= total} onClick={() => onChange(skip + PAGE_SIZE)}>Next</button>
    </div>
  );
}

function Overview({ stats, alerts, activity, onOpen }) {
  return (
    <>
      <div className="stats">
        <Stat n={stats.totalUsers} label="Registered users" />
        <Stat n={stats.totalFiles} label="Monitored files" />
        <Stat n={stats.modifiedFiles} label="Files changed" tone={stats.modifiedFiles ? "bad" : ""} />
        <Stat n={stats.flaggedFiles} label="Files needing review" tone={stats.flaggedFiles ? "bad" : ""} />
        <Stat n={stats.openIncidents} label="Open incidents" tone={stats.openIncidents ? "bad" : ""} />
        <Stat n={stats.verified} label="Successful checks" tone="ok" />
        <Stat n={stats.modified} label="Detected modifications" tone={stats.modified ? "bad" : ""} />
      </div>
      <Panel title="Recent security alerts">
        {alerts.length === 0 ? <Empty>No security alerts.</Empty> : (
          <Table head={["Alert", "Account", "Status", "Detected"]}>
            {alerts.slice(0, 5).map((alert) => (
              <tr key={alert.id}>
                <Td>{alert.activity?.details?.fileName || eventLabel(alert.activity?.event)}</Td>
                <Td>{alert.activity?.actorName || alert.activity?.actorEmail || "Unknown"}</Td>
                <Td><Status value={alert.status} /></Td>
                <Td>{fmtDate(alert.created)}</Td>
              </tr>
            ))}
          </Table>
        )}
        <button className="btn ghost sm mt-3" onClick={() => onOpen("alerts")}>Review all alerts</button>
      </Panel>
      <Panel title="Recent system activity">
        {!activity.length ? <Empty>No activity has been recorded yet.</Empty> : (
          <Table head={["Activity", "Account", "Details", "When"]}>
            {activity.slice(0, 8).map((item) => (
              <tr key={item.id}>
                <Td>{eventLabel(item.event)}</Td>
                <Td>{item.actorName}</Td>
                <Td>{item.details?.fileName || item.details?.status || item.details?.reason || "—"}</Td>
                <Td>{fmtDate(item.date)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function Users({ users, total, skip, onPage, onStatus, onDetails }) {
  const [details, setDetails] = useState({});
  return (
    <Panel title="Registered users">
      <p className="sub">You may review accounts and suspend/reactivate standard users. Administrator and super-admin roles are protected.</p>
      {!users.length ? <Empty>No registered users were found.</Empty> : (
        <Table head={["User", "Status", "Joined", "Actions"]}>
          {users.map((user) => (
            <Fragment key={user.id}>
              <tr>
                <Td><strong>{user.name}</strong><br /><span className="hs">{user.email}</span></Td>
                <Td><Status value={user.status} /></Td>
                <Td>{fmtDate(user.created)}</Td>
                <Td><div className="admin-actions">
                  <SmallBtn onClick={async () => {
                    if (details[user.id]) {
                      setDetails({ ...details, [user.id]: null });
                    } else {
                      const result = await onDetails(user.id);
                      if (result) setDetails({ ...details, [user.id]: result });
                    }
                  }}>Account details</SmallBtn>
                  <SmallBtn onClick={() => onStatus(user, user.status === "active" ? "suspended" : "active")}>
                    {user.status === "active" ? "Suspend" : "Reactivate"}
                  </SmallBtn>
                </div></Td>
              </tr>
              {details[user.id] && <tr key={`${user.id}-details`}><Td colSpan="4">
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
      <Pagination total={total} skip={skip} onChange={onPage} />
    </Panel>
  );
}

function Files({ files, total, skip, onPage, allowVerify, verifyingId, onVerify, onVerifyStored }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const [showChanges, setShowChanges] = useState(false);
  const toast = useToast();

  return (
    <Panel title="System-wide monitored files">
      <p className="sub">This view contains file metadata and SHA-256 fingerprints. Stored file contents remain private to their owner. Scan findings are reported, not blocked.</p>
      {!files.length ? <Empty>No files are registered.</Empty> : (
        <Table head={["File / ID", "Owner", "Registered", "Integrity", "Security scan", "Verification"]}>
          {files.map((file) => (
            <Fragment key={file.id}>
              <tr>
                <Td><strong>{file.name}</strong><br /><span className="hs mono">{file.id}</span></Td>
                <Td>{file.owner?.name || "Unknown"}<br /><span className="hs">{file.owner?.email}</span></Td>
                <Td>{fmtDate(file.date)}</Td>
                <Td><Status value={file.latestStatus} /><br /><span className="hs">{file.verificationCount} checks</span></Td>
                <Td><Status value={file.securityStatus} /></Td>
                <Td>{allowVerify ? <SmallBtn onClick={() => {
                  setSelectedFile(selectedFile?.id === file.id ? null : file);
                  setResult(null);
                  setShowChanges(false);
                }}>Verify authorized copy</SmallBtn> : <span className="hs">Metadata only</span>}</Td>
              </tr>
              {allowVerify && selectedFile?.id === file.id && <tr key={`${file.id}-verify`}><Td colSpan="6">
                <form className="admin-file-verify" onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  onVerify(file, data.get("file"), reason).then((response) => {
                    if (response) {
                      setResult(response);
                      setShowChanges(false);
                      form.reset();
                      setReason("");
                    }
                  });
                }}>
                  <p>Check the stored copy on the server, or compare an authorized current copy with the original SHA-256 baseline. The baseline is never replaced.</p>
                  <label>Authorized file copy<input name="file" type="file" required /></label>
                  <label>Reason for verification<input required maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Document authorization for this check" /></label>
                  <button className="btn" type="submit" disabled={verifyingId === file.id}>{verifyingId === file.id ? "Checking…" : "Compare with original"}</button>
                  <button className="btn ghost" type="button" disabled={verifyingId === file.id} onClick={() => {
                    onVerifyStored(file).then((response) => {
                      if (response) setResult(response);
                    });
                  }}>{verifyingId === file.id ? "Checking…" : "Verify stored copy"}</button>
                  {result && <>
                    <p role="status">Result: <Status value={result.result} /> <Status value={result.securityStatus} /></p>
                    <p className="hs">Structure: {result.structureStatus || "not checked"} · Malware: {result.malwareStatus || "not checked"} · Integrity: {result.integrityStatus || "not checked"}</p>
                      {result.result === "modified" && result.diff?.available && <>
                        <SmallBtn onClick={() => setShowChanges(!showChanges)}>
                          {showChanges ? "Hide changes" : "View changes"}
                        </SmallBtn>
                        {showChanges && <FileDiff diff={result.diff} />}
                      </>}
                      {result.result === "modified" && result.diff && !result.diff.available && <SmallBtn onClick={() => toast(
                        "Line-by-line changes aren't available for binary files or files over 2 MB."
                      )}>View changes</SmallBtn>}
                    <dl className="mt-3 grid gap-2 break-all font-mono text-xs">
                      <div><dt className="font-sans text-mute">Registered hash</dt><dd>{result.storedHash}</dd></div>
                      <div><dt className="font-sans text-mute">Retrieved file hash</dt><dd>{result.newHash}</dd></div>
                    </dl>
                  </>}
                </form>
              </Td></tr>}
            </Fragment>
          ))}
        </Table>
      )}
      <Pagination total={total} skip={skip} onChange={onPage} />
    </Panel>
  );
}

function ScanHistory({ scans, total, skip, onPage }) {
  return (
    <Panel title="File security scan history">
      <p className="sub">Review structure, known-signature malware, and baseline-check results. ClamAV signatures do not provide behavioral sandboxing and cannot establish that a file is harmless.</p>
      {!scans.length ? <Empty>No file scans have been recorded.</Empty> : (
        <Table head={["File / owner", "Result", "Structure", "Malware", "Integrity", "Scanned"]}>
          {scans.map((scan) => (
            <tr key={scan.id}>
              <Td><strong>{scan.fileName}</strong><br /><span className="hs">{scan.owner?.name || "Deleted account"} · {scan.owner?.email || "—"}</span><br /><span className="hs mono">{scan.fileId || "No registered baseline"}</span></Td>
              <Td><Status value={scan.securityStatus} /></Td>
              <Td><Status value={scan.structureStatus} /><br /><span className="hs">{scan.structureMessage}</span></Td>
              <Td><Status value={scan.malwareStatus} /><br /><span className="hs">{scan.malwareSignature || scan.malwareMessage}</span></Td>
              <Td><Status value={scan.integrityStatus} />{scan.baselineHash && <details><summary>Hashes</summary><span className="hs mono">Baseline: {scan.baselineHash}<br />Checked: {scan.fileHash}</span></details>}</Td>
              <Td>{fmtDate(scan.date)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination total={total} skip={skip} onChange={onPage} />
    </Panel>
  );
}

function AlertList({ alerts, total, skip, onPage, onUpdate }) {
  const [notes, setNotes] = useState({});
  return (
    <Panel title="Security alerts">
      <p className="sub">A hash mismatch means file contents changed; it does not by itself prove an attack. Investigate before taking account action.</p>
      {!alerts.length ? <Empty>No security alerts.</Empty> : alerts.map((alert) => (
        <article className="incident-card" key={alert.id}>
          <div className="incident-title">
            <div>
              <h4>{alert.activity?.details?.fileName || eventLabel(alert.activity?.event)}</h4>
              <p>{alert.activity?.details?.reason || alert.activity?.details?.structureMessage || alert.activity?.details?.malwareMessage || "FileGuard recorded a security event."}</p>
            </div>
            <div><Status value={alert.severity} /> <Status value={alert.status} /></div>
          </div>
          <p className="hs">
            {alert.activity?.actorName || alert.activity?.actorEmail || "Unknown account"}
            {alert.activity?.targetFileId ? ` · File ${alert.activity.targetFileId}` : ""}
            {` · ${fmtDate(alert.created)}`}
          </p>
          {alert.activity?.details?.storedHash && <details>
            <summary>Compare recorded fingerprints</summary>
            <p className="mono admin-hash">Original: {alert.activity.details.storedHash}</p>
            <p className="mono admin-hash">Checked: {alert.activity.details.newHash}</p>
          </details>}
          {alert.notes?.map((note) => <p className="incident-note" key={note._id}>
            {note.text} <span className="hs">— {note.author?.name || "Admin"}, {fmtDate(note.createdAt)}</span>
          </p>)}
          <form className="incident-update" onSubmit={(event) => {
            event.preventDefault();
            const note = notes[alert.id] || "";
            const status = alert.status === "open" ? "investigating" : "resolved";
            onUpdate(alert.id, { status, note, escalate: Boolean(event.nativeEvent.submitter?.value === "escalate") }).then((success) => {
              if (success) setNotes({ ...notes, [alert.id]: "" });
            });
          }}>
            <input required minLength="1" maxLength="2000" value={notes[alert.id] || ""} onChange={(event) => setNotes({ ...notes, [alert.id]: event.target.value })} placeholder="Investigation note" />
            <button className="btn ghost" value="update" disabled={alert.status === "resolved"}>{alert.status === "open" ? "Start investigation" : "Resolve alert"}</button>
            {alert.status !== "resolved" && <button className="btn ghost" value="escalate">Escalate to super admin</button>}
          </form>
          {alert.escalatedAt && <p className="hs">Escalated to super admin {fmtDate(alert.escalatedAt)}</p>}
        </article>
      ))}
      <Pagination total={total} skip={skip} onChange={onPage} />
    </Panel>
  );
}

function VerificationHistory({ history, total, skip, onPage }) {
  return (
    <Panel title="System-wide verification history">
      {!history.length ? <Empty>No verification attempts have been recorded.</Empty> : (
        <Table head={["File", "Owner", "Checked by", "Result", "Alert", "Date"]}>
          {history.map((item) => (
            <tr key={item.id}>
              <Td>{item.fileName}<br /><span className="hs mono">{item.fileId || ""}</span></Td>
              <Td>{item.owner?.name || "Unknown"}<br /><span className="hs">{item.owner?.email}</span></Td>
              <Td>{item.performedBy}<br /><span className="hs">{item.performedByEmail}</span></Td>
              <Td><Status value={item.result} /></Td>
              <Td>{item.alert ? <Status value={item.alert.status} /> : "—"}</Td>
              <Td>{fmtDate(item.date)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination total={total} skip={skip} onChange={onPage} />
    </Panel>
  );
}

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ActivityList({ activity, total, skip, archived, busy, onPage, onArchive, onRestore, onToggleArchived }) {
  const [before, setBefore] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return localDateValue(date);
  });

  return (
    <Panel title={archived ? "Archived system activity" : "System audit activity"}>
      <div className="activity-archive-controls">
        <button className="btn ghost sm" type="button" onClick={onToggleArchived} disabled={busy}>
          {archived ? "View active logs" : "View archived logs"}
        </button>
        {!archived && <form className="activity-archive-form" onSubmit={(event) => {
          event.preventDefault();
          const cutoff = new Date(`${before}T00:00:00`).toISOString();
          if (window.confirm(`Archive activity created before ${before}? The records will remain available in Archived Logs and can be restored.`)) {
            onArchive(cutoff);
          }
        }}>
          <label>Archive logs before<input type="date" required max={localDateValue(new Date())} value={before} onChange={(event) => setBefore(event.target.value)} /></label>
          <button className="btn sm" type="submit" disabled={busy}>Archive older logs</button>
        </form>}
      </div>
      <p className="sub">Archiving keeps the audit records retrievable. Security alerts remain available in the Security Alerts section.</p>
      {!activity.length ? <Empty>No system activity has been recorded.</Empty> : (
        <Table head={["Event", "Actor", "Details", "IP", "Date", ...(archived ? ["Action"] : [])]}>
          {activity.map((item) => (
            <tr key={item.id}>
              <Td>{eventLabel(item.event)}<br /><Status value={item.severity} /></Td>
              <Td>{item.actorName}<br /><span className="hs">{item.actorEmail}</span></Td>
              <Td>{item.details?.fileName || item.details?.status || item.details?.reason || "—"}</Td>
              <Td className="mono">{item.ip || "—"}</Td>
              <Td>{fmtDate(item.date)}</Td>
              {archived && <Td><SmallBtn disabled={busy} onClick={() => onRestore(item.id)}>Restore</SmallBtn></Td>}
            </tr>
          ))}
        </Table>
      )}
      <Pagination total={total} skip={skip} onChange={onPage} />
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
    <Panel title="Reports">
      <p>Export registered users, files, successful checks, modifications, security alerts, incidents, and administrative activity as CSV.</p>
      <div className="report-period">
        <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="btn" disabled={busy} onClick={() => onDownload({ from, to })}>Download CSV report</button>
      </div>
    </Panel>
  );
}

function Profile({ user, onUserUpdated, runAction }) {
  const [profile, setProfile] = useState({ name: user.name, email: user.email });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  return (
    <>
      <Panel title="Admin profile">
        <p><Status value="admin" /> Your role is assigned by the super admin and cannot be changed here.</p>
        <form className="admin-form-grid" onSubmit={(event) => {
          event.preventDefault();
          runAction(async () => {
            const result = await profileApi.updateProfile(profile);
            onUserUpdated(result.user);
          }, "Profile updated.");
        }}>
          <label>Name<input required maxLength="100" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
          <label>Email<input required type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></label>
          <button className="btn">Save profile</button>
        </form>
      </Panel>
      <Panel title="Change password">
        <form className="admin-form-grid" onSubmit={(event) => {
          event.preventDefault();
          runAction(async () => {
            const result = await profileApi.changePassword(passwords);
            onUserUpdated(result.user);
            setPasswords({ currentPassword: "", newPassword: "" });
          }, "Password changed. Your other sessions have been revoked.");
        }}>
          <label>Current password<input type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength="8" required value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label>
          <button className="btn">Change password</button>
        </form>
      </Panel>
    </>
  );
}

export default function AdminDashboard({ user, onUserUpdated }) {
  const toast = useToast();
  const [section, setSection] = useState("overview");
  const [stats, setStats] = useState(defaultStats);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [scans, setScans] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const [history, setHistory] = useState([]);
  const [activity, setActivity] = useState([]);
  const [overviewActivity, setOverviewActivity] = useState([]);
  const [activityArchived, setActivityArchived] = useState(false);
  const [totals, setTotals] = useState({});
  const [skips, setSkips] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState("");
  const [error, setError] = useState("");

  const skip = skips[section] || 0;
  const loadOverview = useCallback(async () => {
    const [overview, alertPage, openAlerts, activityPage] = await Promise.all([
      adminApi.get("/overview"),
      adminApi.get("/alerts?limit=5&status=open"),
      adminApi.get("/alerts?limit=1&status=open"),
      adminApi.get("/activity?limit=10"),
    ]);
    setStats(overview.stats);
    setAlerts(alertPage.alerts);
    setOpenAlertCount(openAlerts.total);
    setOverviewActivity(activityPage.activity);
  }, []);

  const loadSection = useCallback(async () => {
    const query = `limit=${PAGE_SIZE}&skip=${skip}`;
    if (section === "users") {
      const response = await adminApi.get(`/users?${query}&role=user`);
      setUsers(response.users);
      setTotals((current) => ({ ...current, users: response.total }));
    } else if (section === "files" || section === "verify") {
      const response = await adminApi.get(`/files?${query}`);
      setFiles(response.files);
      setTotals((current) => ({ ...current, files: response.total }));
    } else if (section === "scans") {
      const response = await adminApi.get(`/scan-history?${query}`);
      setScans(response.scans);
      setTotals((current) => ({ ...current, scans: response.total }));
    } else if (section === "alerts" || section === "notifications") {
      const response = await adminApi.get(`/alerts?${query}${section === "notifications" ? "&status=open" : ""}`);
      setAlerts(response.alerts);
      setTotals((current) => ({ ...current, [section]: response.total }));
    } else if (section === "history") {
      const response = await adminApi.get(`/verification-history?${query}`);
      setHistory(response.history);
      setTotals((current) => ({ ...current, history: response.total }));
    } else if (section === "activity") {
      const response = await adminApi.get(`/activity?${query}&archived=${activityArchived}`);
      setActivity(response.activity);
      setTotals((current) => ({ ...current, activity: response.total }));
    }
  }, [section, skip, activityArchived]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadOverview(), loadSection()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load admin dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadSection]);

  useEffect(() => { reload(); }, [reload]);

  const runAction = async (operation, successMessage) => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      await reload();
      toast(successMessage);
      return result ?? true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The admin action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = (target, status) => {
    const reason = window.prompt(`Why are you changing ${target.name}'s account status?`);
    if (!reason?.trim()) return;
    runAction(
      () => adminApi.mutate(`/users/${encodeURIComponent(target.id)}/status`, "PATCH", { status, reason }),
      `Account ${status}.`
    );
  };

  const getDetails = async (id) => {
    try {
      return await adminApi.get(`/users/${encodeURIComponent(id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load user details.");
      return null;
    }
  };

  const verifyFile = (file, selected, reason) => {
    if (!(selected instanceof File)) {
      setError("Select the authorized file copy first.");
      return Promise.resolve(false);
    }
    return runAction(async () => {
      setVerifyingId(file.id);
      try {
        return (await adminApi.verifyFile(file.id, selected, reason)).log;
      } finally {
        setVerifyingId("");
      }
    }, "Verification recorded. The original fingerprint was not changed.");
  };

  const verifyStoredFile = (file) => runAction(async () => {
    setVerifyingId(file.id);
    try {
      return (await adminApi.verifyStoredFile(file.id)).log;
    } finally {
      setVerifyingId("");
    }
  }, "Stored file integrity check recorded.");

  const updateAlert = (id, body) => runAction(
    () => adminApi.mutate(`/alerts/${encodeURIComponent(id)}`, "PATCH", body),
    body.escalate ? "Alert investigation updated and escalated to the super admin." : "Alert investigation updated."
  );

  const archiveActivity = (before) => runAction(
    () => adminApi.archiveActivity(before),
    "Older activity archived. It remains available in Archived Logs."
  );

  const restoreActivity = (id) => runAction(
    () => adminApi.restoreActivity(id),
    "Activity record restored to the active log."
  );

  const downloadReport = (filters) => runAction(async () => {
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
      <PageHead title="FileGuard Admin Dashboard" sub={`System monitoring and account support · ${user.name}`} />
      <div className="admin-layout">
        <nav className="admin-tabs" aria-label="Admin dashboard sections">
          {sections.map(([key, label]) => (
            <button type="button" className={section === key ? "selected" : ""} key={key} onClick={() => setSection(key)}>
              {label}{key === "notifications" && openAlertCount > 0 ? ` (${openAlertCount})` : ""}
            </button>
          ))}
        </nav>
        <main className="admin-content">
          {error && <ErrorText>{error}</ErrorText>}
          {loading ? <Spinner /> : (
            <>
              {section === "overview" && <Overview stats={stats} alerts={alerts} activity={overviewActivity} onOpen={setSection} />}
              {section === "users" && <Users users={users} total={totals.users || 0} skip={skip} onPage={(value) => setSkips({ ...skips, users: value })} onStatus={updateStatus} onDetails={getDetails} />}
              {(section === "files" || section === "verify") && <Files files={files} total={totals.files || 0} skip={skip} onPage={(value) => setSkips({ ...skips, [section]: value })} allowVerify={section === "verify"} verifyingId={verifyingId} onVerify={verifyFile} onVerifyStored={verifyStoredFile} />}
              {section === "scans" && <ScanHistory scans={scans} total={totals.scans || 0} skip={skip} onPage={(value) => setSkips({ ...skips, scans: value })} />}
              {section === "alerts" && <AlertList alerts={alerts} total={totals.alerts || 0} skip={skip} onPage={(value) => setSkips({ ...skips, alerts: value })} onUpdate={updateAlert} />}
              {section === "notifications" && <AlertList alerts={alerts} total={totals.notifications || 0} skip={skip} onPage={(value) => setSkips({ ...skips, notifications: value })} onUpdate={updateAlert} />}
              {section === "history" && <VerificationHistory history={history} total={totals.history || 0} skip={skip} onPage={(value) => setSkips({ ...skips, history: value })} />}
              {section === "activity" && <ActivityList
                activity={activity}
                total={totals.activity || 0}
                skip={skip}
                archived={activityArchived}
                busy={busy}
                onPage={(value) => setSkips({ ...skips, activity: value })}
                onArchive={archiveActivity}
                onRestore={restoreActivity}
                onToggleArchived={() => {
                  setActivityArchived(!activityArchived);
                  setSkips({ ...skips, activity: 0 });
                }}
              />}
              {section === "reports" && <Reports busy={busy} onDownload={downloadReport} />}
              {section === "profile" && <Profile user={user} onUserUpdated={onUserUpdated} runAction={runAction} />}
            </>
          )}
        </main>
      </div>
    </>
  );
}

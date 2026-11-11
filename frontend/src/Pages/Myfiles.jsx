import { useState } from "react";
import { api } from "../api";
import { Empty, ErrorText, FormError, PageHead, Panel, SmallBtn, Spinner, Table, Td } from "../components/UI";
import { useToast } from "../context/ToastContext";
import useLoad from "../hooks/useLoad";
import { errMsg, fmtDate, fmtSize } from "../utils";

function securityLabel(status) {
  return ({
    healthy: "PASSED AVAILABLE CHECKS",
    corrupted: "INVALID STRUCTURE",
    malicious: "KNOWN MALWARE SIGNATURE DETECTED",
    infected: "KNOWN MALWARE SIGNATURE DETECTED",
    inconclusive: "SCAN INCOMPLETE — NO VERDICT",
    scan_unavailable: "SCAN INCOMPLETE — NO VERDICT",
    modified: "HASH MISMATCH",
    not_scanned: "NOT SCANNED",
  })[status] || "NOT SCANNED";
}

function statusLabel(status) {
  return (status || "not checked").replaceAll("_", " ");
}

export default function MyFiles() {
  const { data: files, loading, error, reload } = useLoad(api.getFiles, []);
  const { data: policy } = useLoad(api.getFilePolicy, { maximumFileSize: 50 * 1024 * 1024 });
  const toast = useToast();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [scanNotice, setScanNotice] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [deletingId, setDeletingId] = useState("");

  const add = async (list) => {
    if (!list.length) return;
    setErr(""); setScanNotice(null); setBusy(true);
    let healthy = 0; const flagged = []; const errs = [];
    try {
      for (const [index, f] of list.entries()) {
        setScanProgress({ name: f.name, index: index + 1, total: list.length });
        if (f.size > policy.maximumFileSize) { errs.push(`${f.name} is over the ${fmtSize(policy.maximumFileSize)} system limit.`); continue; }
        try {
          const record = await api.addFile(f);
          if (record.securityStatus === "healthy") healthy += 1;
          else flagged.push({
            name: record.name,
            status: record.securityStatus,
            structureStatus: record.scan?.structureStatus,
            malwareStatus: record.scan?.malwareStatus,
            integrityStatus: record.scan?.integrityStatus,
            message: [record.scan?.structureMessage, record.scan?.malwareMessage].filter(Boolean).join(" "),
          });
        } catch (x) { errs.push(errMsg(x)); }
      }
    } finally {
      setBusy(false);
      setScanProgress(null);
    }
    setErr(errs.join(" "));
    setScanNotice({ healthy, flagged });
    const threats = flagged.filter((item) => item.status === "malicious" || item.status === "infected").length;
    if (threats) {
      toast(`${threats} file${threats === 1 ? " was" : "s were"} flagged with a known malware signature.`, "error");
    } else if (flagged.length) {
      toast(`${flagged.length} file${flagged.length === 1 ? " needs" : "s need"} review; see the scan results below.`, "warning");
    } else if (healthy) {
      toast(`${healthy} file${healthy === 1 ? "" : "s"} passed the available checks.`, "success");
    }
    reload();
  };
  const remove = async (f) => {
    if (!window.confirm(`Delete ${f.name} from your registered files? Its saved copy will be deleted. Scan and verification history will remain.`)) return;
    setErr("");
    setDeletingId(f.id);
    try {
      await api.deleteFile(f.id);
      toast(`${f.name} was deleted from your registered files.`, "success");
      reload();
    } catch (x) { setErr(errMsg(x)); }
    finally { setDeletingId(""); }
  };
  const download = async (file) => {
    if (file.securityStatus !== "healthy" && !window.confirm(
      `${securityLabel(file.securityStatus)}. FileGuard does not block downloads, but this file may be unsafe. Download it anyway?`
    )) return;
    setErr("");
    try { await api.downloadStoredFile(file.id, file.name); } catch (x) { setErr(errMsg(x)); }
  };
  const copy = async (hash) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(hash);
      toast("Hash copied.", "success");
    } catch {
      toast("Could not copy the hash. Check clipboard permissions and try again.", "warning");
    }
  };
  const detectedThreats = scanNotice?.flagged.filter((item) => item.status === "malicious" || item.status === "infected") || [];
  const otherResults = scanNotice?.flagged.filter((item) => item.status !== "malicious" && item.status !== "infected") || [];

  return (
    <>
      <PageHead title="My files" sub="Uploads are checked for supported file structures, compared with the original SHA-256 baseline, and scanned for known malware signatures. Results are reported without blocking access." />
      <Panel>
        <p className="sub">A clean signature scan cannot prove a file is harmless. FileGuard does not run files in a behavioral sandbox and cannot reliably detect every attempt to steal data, change files, encrypt content, install software, contact servers, or exploit vulnerabilities. Unsupported formats or unavailable scanners are reported as inconclusive.</p>
        {busy && scanProgress && <div className="scan-progress" role="status" aria-live="polite" aria-busy="true">
          <span className="scan-spinner" aria-hidden="true" />
          <span>Scanning file {scanProgress.index} of {scanProgress.total}: <strong>{scanProgress.name}</strong>. Please wait…</span>
        </div>}
        <label
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add([...e.dataTransfer.files]); }}
          className={`drop${over ? " over" : ""}`}
        >
          <input type="file" multiple disabled={busy} onChange={(e) => { add([...e.target.files]); e.target.value = ""; }} />
          <b>{busy ? "Registering…" : "Choose files to register"}</b><br /><span className="hs">or drop them here</span>
        </label>
        <FormError>{err}</FormError>
        {detectedThreats.length > 0 && <div role="alert" className="result bad">
          <strong>SECURITY WARNING — KNOWN MALWARE SIGNATURE DETECTED</strong>
          <p>Do not open or execute these files. A security alert is available to administrators.</p>
          <ul>{detectedThreats.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}: {item.message}</li>)}</ul>
        </div>}
        {otherResults.length > 0 && <div role="status" className="result neutral">
          <strong>Scan results</strong>
          <p>An incomplete scan or a file change alone is not evidence of malware. Results for each available check are listed below.</p>
          <ul>{otherResults.map((item, index) => <li key={`${item.name}-${index}`}>
            {item.name}: {securityLabel(item.status)}. Integrity: {item.integrityStatus || "not checked"}; structure: {item.structureStatus || "not checked"}; malware scan: {item.malwareStatus || "not checked"}. {item.message}
          </li>)}</ul>
        </div>}
        {scanNotice?.healthy > 0 && <p role="status" className="result ok">{scanNotice.healthy} file{scanNotice.healthy === 1 ? "" : "s"} passed the available checks.</p>}
      </Panel>
      <Panel title={`Registered files (${files.length})`}>
        {loading ? <Spinner /> : error ? <ErrorText>{error}</ErrorText> : !files.length ?         <Empty>No files registered. Choose a file above to save its original copy and fingerprint.</Empty> : (
          <Table head={["Name", "Size", "Original SHA-256", "Security status", "Registered", ""]}>
            {files.map((f) => (
              <tr key={f.id}>
                <Td>{f.name}{!f.hasOriginalCopy && <><br /><span className="hs">Original content is not stored; hash comparisons are available, but not line-by-line diffs.</span></>}</Td><Td>{fmtSize(f.size)}</Td>
                <Td className="font-mono text-xs text-mute"><span title={f.hash}>{f.hash.slice(0, 16)}…{f.hash.slice(-8)}</span></Td>
                <Td>
                  <span className={`pill ${f.securityStatus === "healthy" ? "ok" : ["inconclusive", "scan_unavailable"].includes(f.securityStatus) ? "" : "bad"}`}>{securityLabel(f.securityStatus)}</span>
                  <br /><span className="hs">{statusLabel(f.structureStatus)} structure · {statusLabel(f.malwareStatus)} malware · {statusLabel(f.integrityStatus)} integrity</span>
                  {(f.structureMessage || f.malwareSignature || f.malwareMessage) && <><br /><span className="hs">{f.structureMessage} {f.malwareSignature || f.malwareMessage}</span></>}
                </Td>
                <Td>{fmtDate(f.date)}</Td>
                <Td className="whitespace-nowrap"><SmallBtn disabled={!f.hasOriginalCopy} onClick={() => download(f)}>Download</SmallBtn> <SmallBtn onClick={() => copy(f.hash)}>Copy hash</SmallBtn> <SmallBtn disabled={deletingId === f.id} onClick={() => remove(f)}>{deletingId === f.id ? "Deleting…" : "Delete"}</SmallBtn></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
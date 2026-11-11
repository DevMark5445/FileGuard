import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "../api";
import { Button, Empty, ErrorText, FormError, PageHead, Panel, Spinner } from "../components/UI";
import { useToast } from "../context/ToastContext";
import useLoad from "../hooks/useLoad";
import { errMsg, fmtDate, fmtSize } from "../utils";
import FileDiff from "../components/FileDiff";

export default function Verify() {
  const { data: files, loading, error } = useLoad(api.getFiles, []);
  const { data: policy } = useLoad(api.getFilePolicy, { maximumFileSize: 50 * 1024 * 1024 });
  const { refreshAlerts } = useOutletContext();
  const toast = useToast();
  const [id, setId] = useState("");
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [showChanges, setShowChanges] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setErr(""); setRes(null); setShowChanges(false);
    if (!file) return setErr("Select the current copy of the file to check.");
    if (file.size > policy.maximumFileSize) return setErr(`File exceeds the ${fmtSize(policy.maximumFileSize)} system limit.`);
    setBusy(true);
    try {
      const result = await api.verify(id || files[0].id, file);
      setRes(result);
      if (result.integrityStatus === "matched") {
        toast("Hash matched: the file is unchanged from its registered baseline.", "success");
      } else if (result.integrityStatus === "mismatched") {
        toast("Hash mismatch: the file has changed from its registered baseline.", "error");
      } else if (result.securityStatus === "malicious") {
        toast("Security warning: a known malware signature was detected.", "error");
      } else if (result.securityStatus === "inconclusive") {
        toast("Security scan completed, but could not provide a complete verdict.", "warning");
      } else if (result.securityStatus === "healthy") {
        toast("File verified: it matches the registered baseline.", "success");
      } else {
        toast("File verification completed.");
      }
      await refreshAlerts();
    }
    catch (x) { setErr(errMsg(x)); }
    finally { setBusy(false); }
  };
  const ok = res?.securityStatus === "healthy";
  const showDetailedResult = res &&
    !(res.securityStatus === "inconclusive" && res.integrityStatus === "matched");
  const resultHeading = res?.securityStatus === "malicious" ? "Known malware signature detected"
    : res?.securityStatus === "corrupted" ? "File structure is invalid"
      : res?.securityStatus === "modified" ? "File hash does not match the baseline"
        : res?.securityStatus === "inconclusive" ? "Security checks are inconclusive"
          : res?.result === "intact" ? "File matches the original hash" : "File hash does not match the baseline";
  return (
    <>
      <PageHead title="Verify a file" sub="Choose a registered file and its current copy. FileGuard checks it and, if changed, shows line differences and keeps the changed copy available to you." />
      <Panel>
        {loading ? <Spinner /> : error ? <ErrorText>{error}</ErrorText> : !files.length ? (
          <Empty>Register a file first, then come back to verify it.<br /><Link to="/files" className="mt-3 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-ink">Register a file</Link></Empty>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="sf" className="mb-1 block font-medium">Registered file</label>
                <select id="sf" value={id || files[0].id} onChange={(e) => { setId(e.target.value); setRes(null); }} className="w-full rounded-md border border-line bg-panel px-3 py-2">
                  {files.map((f) => <option key={f.id} value={f.id}>{f.name}{f.hasOriginalCopy ? "" : " (hash comparison only)"}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="vf" className="mb-1 block font-medium">Current copy</label>
                <input id="vf" type="file" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); }} className="w-full rounded-md border border-line bg-panel px-3 py-2" />
              </div>
            </div>
            <FormError>{err}</FormError>
            <Button onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify file"}</Button>
            {showDetailedResult && (
              <div role="alert" className={`result ${ok ? "ok" : "bad"}`}>
                <h3 className="mb-1 text-base font-semibold">{resultHeading}</h3>
                <p>{res.securityStatus === "malicious"
                  ? "ClamAV matched a known malware signature. Do not open or execute this file."
                  : res.securityStatus === "corrupted"
                    ? "The supported-format structure check failed. The file may be damaged or incomplete."
                    : res.securityStatus === "modified"
                      ? "The SHA-256 hash differs from the original baseline. This confirms changed content, not necessarily malicious activity."
                      : res.securityStatus === "inconclusive"
                        ? "At least one check could not fully assess this file. A clean or unavailable signature scan is not proof that it is safe."
                        : `${res.fileName} matches the hash saved in the original baseline and passed the available checks.`}</p>
                <p className="hs">Integrity: {res.integrityStatus || res.result} · Structure: {res.structureStatus || "not checked"} · Malware: {res.malwareStatus || "not checked"}</p>
                {res.malwareSignature && <p className="hs">Signature: {res.malwareSignature}</p>}
                <dl className="mt-3 grid gap-2 break-all font-mono text-xs">
                  <div><dt className="font-sans text-mute">Stored hash</dt><dd>{res.storedHash}</dd></div>
                  <div><dt className="font-sans text-mute">Current hash</dt><dd>{res.newHash}</dd></div>
                </dl>
                {res.result === "modified" && res.diff?.available && <>
                  <Button className="btn mt-3" onClick={() => setShowChanges(!showChanges)}>
                    {showChanges ? "Hide changes" : "View changes"}
                  </Button>
                  {showChanges && <FileDiff diff={res.diff} />}
                </>}
                {res.result === "modified" && res.diff && !res.diff.available && <>
                  <Button className="btn mt-3" onClick={() => toast(
                    "Line-by-line changes aren't available for binary files or files over 2 MB. The hashes confirm the file changed; you can download the changed copy."
                  )}>View changes</Button>
                </>}
                {res.changedCopyAvailable && (
                  <>
                    <p className="mt-3 text-sm text-mute">This changed copy is available even when a scan raises a concern. Review the results before opening it.</p>
                    <Button className="btn mt-3" onClick={async () => {
                      if (res.securityStatus !== "healthy" && !window.confirm("The changed copy did not pass all available checks. Download it anyway?")) return;
                      try { await api.downloadChangedCopy(res.id, res.fileName); }
                      catch (x) { setErr(errMsg(x)); }
                    }}>Download changed copy</Button>
                    {res.changedFileExpiresAt && <p className="mt-2 text-sm text-mute">Available until {fmtDate(res.changedFileExpiresAt)}.</p>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
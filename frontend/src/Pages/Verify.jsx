import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "../api";
import { Button, Empty, ErrorText, FormError, PageHead, Panel, Spinner } from "../components/UI";
import useLoad from "../hooks/useLoad";
import { MAX_SIZE, errMsg } from "../utils";

export default function Verify() {
  const { data: files, loading, error } = useLoad(api.getFiles, []);
  const { refreshAlerts } = useOutletContext();
  const [id, setId] = useState("");
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setErr(""); setRes(null);
    if (!file) return setErr("Select the current copy of the file to check.");
    if (file.size > MAX_SIZE) return setErr("File is over 50 MB.");
    setBusy(true);
    try { setRes(await api.verify(id || files[0].id, file)); refreshAlerts(); }
    catch (x) { setErr(errMsg(x)); }
    finally { setBusy(false); }
  };
  const ok = res?.result === "intact";
  return (
    <>
      <PageHead title="Verify a file" sub="Pick a registered file, then select its current copy from your device." />
      <Panel>
        {loading ? <Spinner /> : error ? <ErrorText>{error}</ErrorText> : !files.length ? (
          <Empty>Register a file first, then come back to verify it.<br /><Link to="/files" className="mt-3 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-ink">Register a file</Link></Empty>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="sf" className="mb-1 block font-medium">Registered file</label>
                <select id="sf" value={id || files[0].id} onChange={(e) => { setId(e.target.value); setRes(null); }} className="w-full rounded-md border border-line bg-panel px-3 py-2">
                  {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="vf" className="mb-1 block font-medium">Current copy</label>
                <input id="vf" type="file" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); }} className="w-full rounded-md border border-line bg-panel px-3 py-2" />
              </div>
            </div>
            <FormError>{err}</FormError>
            <Button onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify file"}</Button>
            {res && (
              <div role="alert" className={`mt-4 rounded-lg border p-5 ${ok ? "border-ok bg-okbg" : "border-bad bg-badbg"}`}>
                <h3 className="mb-1 text-base font-semibold">{ok ? "File is unchanged" : "Security alert: file has been modified"}</h3>
                <p>{ok ? `${res.fileName} matches the hash saved when it was registered.` : `${res.fileName} no longer matches its registered hash. It may have been edited, corrupted, or tampered with.`}</p>
                <dl className="mt-3 grid gap-2 break-all font-mono text-xs">
                  <div><dt className="font-sans text-mute">Stored hash</dt><dd>{res.storedHash}</dd></div>
                  <div><dt className="font-sans text-mute">Current hash</dt><dd>{res.newHash}</dd></div>
                </dl>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
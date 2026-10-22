import { useState } from "react";
import { api } from "../api";
import { Empty, ErrorText, FormError, PageHead, Panel, SmallBtn, Spinner, Table, Td } from "../components/UI";
import { useToast } from "../context/ToastContext";
import useLoad from "../hooks/useLoad";
import { MAX_SIZE, errMsg, fmtDate, fmtSize } from "../utils";

export default function MyFiles() {
  const { data: files, loading, error, reload } = useLoad(api.getFiles, []);
  const toast = useToast();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const add = async (list) => {
    if (!list.length) return;
    setErr(""); setBusy(true);
    let n = 0; const errs = [];
    for (const f of list) {
      if (f.size === 0) { errs.push(`${f.name} is empty.`); continue; }
      if (f.size > MAX_SIZE) { errs.push(`${f.name} is over 50 MB.`); continue; }
      try { await api.addFile(f); n++; } catch (x) { errs.push(errMsg(x)); }
    }
    setBusy(false); setErr(errs.join(" "));
    if (n) toast(`${n} file${n > 1 ? "s" : ""} registered`);
    reload();
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.name} from monitoring? Its history stays.`)) return;
    try { await api.deleteFile(f.id); reload(); } catch (x) { setErr(errMsg(x)); }
  };
  const copy = (h) => navigator.clipboard?.writeText(h).then(() => toast("Hash copied"), () => toast("Copy not available"));

  return (
    <>
      <PageHead title="My files" sub="Register a file to save its SHA-256 fingerprint." />
      <Panel>
        <label
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add([...e.dataTransfer.files]); }}
          className={`block cursor-pointer rounded-lg border-2 border-dashed p-8 text-center hover:border-brand ${over ? "border-brand bg-bg" : "border-line"}`}
        >
          <input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => { add([...e.target.files]); e.target.value = ""; }} />
          <b>{busy ? "Registering…" : "Choose files to register"}</b><br /><span className="text-sm text-mute">or drop them here (max 50 MB each)</span>
        </label>
        <FormError>{err}</FormError>
      </Panel>
      <Panel title={`Registered files (${files.length})`}>
        {loading ? <Spinner /> : error ? <ErrorText>{error}</ErrorText> : !files.length ? <Empty>No files registered. Choose a file above to create its fingerprint.</Empty> : (
          <Table head={["Name", "Size", "Original SHA-256", "Registered", ""]}>
            {files.map((f) => (
              <tr key={f.id}>
                <Td>{f.name}</Td><Td>{fmtSize(f.size)}</Td>
                <Td className="font-mono text-xs text-mute"><span title={f.hash}>{f.hash.slice(0, 16)}…{f.hash.slice(-8)}</span></Td>
                <Td>{fmtDate(f.date)}</Td>
                <Td className="whitespace-nowrap"><SmallBtn onClick={() => copy(f.hash)}>Copy hash</SmallBtn> <SmallBtn onClick={() => remove(f)}>Remove</SmallBtn></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
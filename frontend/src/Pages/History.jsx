import { Fragment, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { Empty, ErrorText, FormError, PageHead, Panel, SmallBtn, Spinner, Table, Td } from "../components/UI";
import useLoad from "../hooks/useLoad";
import { errMsg, fmtDate } from "../utils";
import FileDiff from "../components/FileDiff";

export default function History() {
  const { data: logs, loading, error, reload } = useLoad(api.getHistory, []);
  const { refreshAlerts } = useOutletContext();
  const [err, setErr] = useState("");
  const [diffs, setDiffs] = useState({});
  const [diffLoading, setDiffLoading] = useState("");
  const [downloadBusy, setDownloadBusy] = useState("");
  if (loading) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  const open = logs.filter((l) => l.result === "modified" && !l.reviewed);
  const review = async (id) => {
    setErr("");
    try { await api.reviewLog(id); reload(); await refreshAlerts(); }
    catch (x) { setErr(errMsg(x)); }
  };
  const viewDiff = async (log) => {
    if (diffs[log.id]) {
      setDiffs({ ...diffs, [log.id]: null });
      return;
    }
    setDiffLoading(log.id);
    setErr("");
    try {
      const { diff } = await api.getVerificationDiff(log.id);
      setDiffs({ ...diffs, [log.id]: diff });
    } catch (x) { setErr(errMsg(x)); }
    finally { setDiffLoading(""); }
  };
  const downloadCopy = async (log) => {
    setDownloadBusy(log.id);
    setErr("");
    try { await api.downloadChangedCopy(log.id, log.fileName); }
    catch (x) { setErr(errMsg(x)); }
    finally { setDownloadBusy(""); }
  };
  return (
    <>
      <PageHead title="History & alerts" sub="Your verification results and changed copies." />
      <FormError>{err}</FormError>
      <Panel title={`Open alerts (${open.length})`}>
        {open.length ? (
          <Table head={["File", "Detected", ""]}>
            {open.map((l) => <tr key={l.id}><Td>{l.fileName}</Td><Td>{fmtDate(l.date)}</Td><Td><SmallBtn onClick={() => review(l.id)}>Mark reviewed</SmallBtn></Td></tr>)}
          </Table>
        ) : <Empty>No open alerts.</Empty>}
      </Panel>
      <Panel title="All verifications">
        {!logs.length ? <Empty>No checks yet. Verify a file to see results here.</Empty> : (
          <Table head={["File", "Checked", "Result", "Changed copy"]}>
            {logs.map((log) => (
              <Fragment key={log.id}>
                <tr>
                  <Td>{log.fileName}</Td>
                  <Td>{fmtDate(log.date)}</Td>
                  <Td><span className={`pill ${log.result === "intact" ? "ok" : "bad"}`}>{log.result === "intact" ? "Unchanged" : "Modified"}</span></Td>
                  <Td>{log.hasChangedCopy ? (
                    <>
                      <SmallBtn disabled={diffLoading === log.id} onClick={() => viewDiff(log)}>{diffLoading === log.id ? "Loading…" : diffs[log.id] ? "Hide changes" : "View changes"}</SmallBtn>{" "}
                      <SmallBtn disabled={downloadBusy === log.id} onClick={() => downloadCopy(log)}>{downloadBusy === log.id ? "Preparing…" : "Download"}</SmallBtn>
                      {log.changedCopyExpiresAt && <span className="hs">Available until {fmtDate(log.changedCopyExpiresAt)}</span>}
                    </>
                  ) : "—"}</Td>
                </tr>
                {diffs[log.id] && <tr key={`${log.id}-diff`}><Td colSpan="4"><FileDiff diff={diffs[log.id]} /></Td></tr>}
              </Fragment>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
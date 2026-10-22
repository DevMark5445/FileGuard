import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import LogTable from "../components/LogTable";
import { Empty, ErrorText, FormError, PageHead, Panel, SmallBtn, Spinner, Table, Td } from "../components/UI";
import useLoad from "../hooks/useLoad";
import { errMsg, fmtDate } from "../utils";

export default function History() {
  const { data: logs, loading, error, reload } = useLoad(api.getHistory, []);
  const { refreshAlerts } = useOutletContext();
  const [err, setErr] = useState("");
  if (loading) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  const open = logs.filter((l) => l.result === "modified" && !l.reviewed);
  const review = async (id) => {
    setErr("");
    try { await api.reviewLog(id); reload(); refreshAlerts(); }
    catch (x) { setErr(errMsg(x)); }
  };
  return (
    <>
      <PageHead title="History & alerts" sub="Every verification you have run." />
      <FormError>{err}</FormError>
      <Panel title={`Open alerts (${open.length})`}>
        {open.length ? (
          <Table head={["File", "Detected", ""]}>
            {open.map((l) => <tr key={l.id}><Td>{l.fileName}</Td><Td>{fmtDate(l.date)}</Td><Td><SmallBtn onClick={() => review(l.id)}>Mark reviewed</SmallBtn></Td></tr>)}
          </Table>
        ) : <Empty>No open alerts.</Empty>}
      </Panel>
      <Panel title="All verifications"><LogTable logs={logs} /></Panel>
    </>
  );
}
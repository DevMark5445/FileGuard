import { Link } from "react-router-dom";
import { api } from "../api";
import LogTable from "../components/LogTable";
import { ErrorText, PageHead, Panel, Spinner, Stat } from "../components/UI";
import useLoad from "../hooks/useLoad";

const load = () => Promise.all([api.getFiles(), api.getHistory()]);

export default function Dashboard() {
  const { data: [files, logs], loading, error } = useLoad(load, [[], []]);
  if (loading) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  const mod = logs.filter((l) => l.result === "modified");
  const open = mod.filter((l) => !l.reviewed).length;
  return (
    <>
      <PageHead title="Dashboard" sub="The state of your registered files." />
      {open > 0 && (
        <div role="alert" className="result bad dashboard-alert">
          <h3 className="font-semibold">{open} modified file{open > 1 ? "s" : ""} need your attention</h3>
          <Link to="/history" className="underline">Review alerts</Link>
        </div>
      )}
      <div className="stats">
        <Stat n={files.length} label="Files monitored" />
        <Stat n={logs.length} label="Checks run" />
        <Stat n={logs.length - mod.length} label="Intact results" tone="text-ok" />
        <Stat n={mod.length} label="Modified results" tone="text-bad" />
      </div>
      <Panel title="Recent checks"><LogTable logs={logs.slice(0, 5)} /></Panel>
      <div className="row dashboard-actions">
        <Link to="/files" className="btn">Register a file</Link>
        <Link to="/verify" className="btn ghost">Verify a file</Link>
      </div>
    </>
  );
}
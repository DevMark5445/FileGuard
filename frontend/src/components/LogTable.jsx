import { Empty, Table, Td } from "./UI.jsx";
import { fmtDate } from "../utils.js";

export default function LogTable({ logs }) {
  if (!logs.length) return <Empty>No checks yet. Verify a file to see results here.</Empty>;

  return (
    <Table head={["File", "Checked", "Result"]}>
      {logs.map((log) => (
        <tr key={log.id}>
          <Td>{log.fileName}</Td>
          <Td>{fmtDate(log.date)}</Td>
          <Td>
            <span className={`pill ${log.result === "intact" ? "ok" : "bad"}`}>
              {log.result === "intact" ? "Unchanged" : "Modified"}
            </span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

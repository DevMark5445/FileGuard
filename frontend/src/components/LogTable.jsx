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
            <span className={`pill ${log.securityStatus === "healthy" || log.result === "intact" ? "ok" : ["malicious", "harmful", "modified"].includes(log.securityStatus) || log.result === "modified" ? "bad" : ""}`}>
              {log.securityStatus === "harmful" ? "Potentially harmful content"
                : log.securityStatus === "malicious" ? "Malware detected"
                  : log.securityStatus === "inconclusive" ? "Scan inconclusive"
                    : log.result === "intact" ? "Unchanged"
                      : log.result === "modified" ? "Modified" : "Scanned"}
            </span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

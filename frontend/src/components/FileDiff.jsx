export default function FileDiff({ diff }) {
  if (!diff) return null;
  if (!diff.available) return <p className="mt-3 text-sm text-mute">{diff.message}</p>;
  if (!diff.lines.length) return <p className="mt-3 text-sm text-mute">No line-level differences are available.</p>;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-line">
      <p className="border-b border-line px-3 py-2 text-sm text-mute">
        Changed lines: original and current line numbers are shown.
        {diff.truncated ? " The display is limited to the first 1,000 changed lines." : ""}
      </p>
      <div className="max-h-96 overflow-auto">
        {diff.lines.map((line, index) => (
          <div
            key={`${line.type}-${line.oldLine}-${line.newLine}-${index}`}
            className={`grid grid-cols-[7rem_minmax(0,1fr)] gap-2 px-3 py-1 font-mono text-xs ${
              line.type === "added" ? "bg-green-500/10" : "bg-red-500/10"
            }`}
          >
            <span className="whitespace-nowrap text-mute">
              {line.type === "added" ? `Current L${line.newLine}` : `Original L${line.oldLine}`}
            </span>
            <pre className="whitespace-pre-wrap break-all">{line.type === "added" ? "+ " : "− "}{line.text || " "}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

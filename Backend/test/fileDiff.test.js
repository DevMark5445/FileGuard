const test = require("node:test");
const assert = require("node:assert/strict");
const { createTextDiff } = require("../src/controllers/fileController");

test("text diff reports removed and added lines with original/current locations", () => {
  const diff = createTextDiff(
    Buffer.from("keep\nbefore\nlast\n", "utf8"),
    Buffer.from("keep\nafter\nlast\n", "utf8")
  );

  assert.deepEqual(diff, {
    available: true,
    lines: [
      { type: "removed", oldLine: 2, newLine: null, text: "before" },
      { type: "added", oldLine: null, newLine: 2, text: "after" },
    ],
    truncated: false,
  });
});

test("text diff refuses binary content and oversized files", () => {
  assert.equal(createTextDiff(Buffer.from([0, 1]), Buffer.from([0, 2])).available, false);
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 97);
  assert.equal(createTextDiff(oversized, Buffer.from("text")).available, false);
});

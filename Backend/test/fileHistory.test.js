const test = require("node:test");
const assert = require("node:assert/strict");
const FileRecord = require("../src/models/FileRecord");
const ActivityLog = require("../src/models/ActivityLog");
const { getHistory } = require("../src/controllers/fileController");

test("verification history query is scoped to the signed-in user's owned files", async () => {
  const originalFileFind = FileRecord.find;
  const originalActivityFind = ActivityLog.find;
  const userId = "user-a";
  const ownedFileId = "file-a";
  const log = {
    id: "log-a",
    details: { fileName: "notes.txt", result: "modified" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  let responseBody;

  FileRecord.find = (filter) => {
    assert.deepEqual(filter, { owner: userId });
    return { distinct: async (field) => {
      assert.equal(field, "_id");
      return [ownedFileId];
    } };
  };
  ActivityLog.find = (filter) => {
    assert.deepEqual(filter.$or, [
      { targetUserId: userId },
      { actorId: userId, targetFileId: { $in: [ownedFileId] } },
    ]);
    return {
      sort() { return this; },
      limit: async () => [log],
    };
  };

  try {
    await getHistory({ user: { id: userId } }, {
      json(body) {
        responseBody = body;
        return this;
      },
    }, (error) => { throw error; });
  } finally {
    FileRecord.find = originalFileFind;
    ActivityLog.find = originalActivityFind;
  }

  assert.equal(responseBody.logs.length, 1);
  assert.equal(responseBody.logs[0].fileName, "notes.txt");
});

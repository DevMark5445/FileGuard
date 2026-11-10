const ActivityLog = require("../models/ActivityLog");
const { removeStoredFile } = require("./fileStorage");

async function purgeExpiredChangedCopies(now = new Date()) {
  let removed = 0;
  while (true) {
    const logs = await ActivityLog.find({
      changedFileKey: { $exists: true, $ne: null },
      changedFileExpiresAt: { $lte: now },
    }).select("_id changedFileKey").limit(100);
    if (!logs.length) return removed;

    await Promise.all(logs.map((log) => removeStoredFile(log.changedFileKey)));
    const result = await ActivityLog.updateMany(
      { _id: { $in: logs.map((log) => log._id) }, changedFileExpiresAt: { $lte: now } },
      { $unset: { changedFileKey: "", changedFileExpiresAt: "" } }
    );
    removed += result.modifiedCount;
  }
}

function scheduleChangedCopyCleanup() {
  const timer = setInterval(() => {
    purgeExpiredChangedCopies().catch((error) => {
      console.error("Could not purge expired FileGuard file copies:", error);
    });
  }, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { purgeExpiredChangedCopies, scheduleChangedCopyCleanup };

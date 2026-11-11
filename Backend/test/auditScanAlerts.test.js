const test = require("node:test");
const assert = require("node:assert/strict");
const ActivityLog = require("../src/models/ActivityLog");
const SecurityAlert = require("../src/models/SecurityAlert");
const { recordActivity } = require("../src/utils/audit");

test("scan alerts are created for confirmed malware, not inconclusive checks", async () => {
  const originalActivityCreate = ActivityLog.create;
  const originalAlertCreate = SecurityAlert.create;
  const alerts = [];
  let activityId = 0;
  ActivityLog.create = async (attributes) => ({ ...attributes, id: `activity-${++activityId}` });
  SecurityAlert.create = async (attributes) => {
    alerts.push(attributes);
    return attributes;
  };
  const req = { user: { id: "user-1" }, ip: "127.0.0.1", get: () => "test" };

  try {
    await recordActivity(req, {
      event: "file.scan.completed",
      severity: "info",
      details: { fileName: "report.pdf", securityStatus: "inconclusive", malwareStatus: "unavailable" },
    });
    await recordActivity(req, {
      event: "file.scan.flagged",
      severity: "high",
      details: { fileName: "malware.exe", securityStatus: "malicious", malwareStatus: "infected" },
    });
  } finally {
    ActivityLog.create = originalActivityCreate;
    SecurityAlert.create = originalAlertCreate;
  }

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "high");
  assert.equal(alerts[0].sourceActivity, "activity-2");
});

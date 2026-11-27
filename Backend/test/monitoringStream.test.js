const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");
const { publishMonitoringEvent, subscribeToMonitoring } = require("../src/services/monitoringStream");

test("monitoring events are scoped to their owner and omit private audit data", () => {
  const userMessages = [];
  const otherUserMessages = [];
  const adminMessages = [];
  const response = (messages) => ({
    destroyed: false,
    writableEnded: false,
    write: (message) => messages.push(message),
  });
  const unsubscribeUser = subscribeToMonitoring({ id: "user-1", role: "user" }, response(userMessages));
  const unsubscribeOtherUser = subscribeToMonitoring({ id: "user-2", role: "user" }, response(otherUserMessages));
  const unsubscribeAdmin = subscribeToMonitoring({ id: "admin-1", role: "admin" }, response(adminMessages));

  try {
    publishMonitoringEvent({
      id: "activity-1",
      actorId: "user-1",
      targetUserId: "user-1",
      actorEmail: "private@example.com",
      ip: "192.0.2.1",
      event: "file.modified",
      severity: "warning",
      details: { fileName: "report.pdf", securityStatus: "modified", reason: "private" },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    publishMonitoringEvent({
      id: "activity-2",
      actorId: "user-2",
      targetUserId: "user-2",
      event: "file.scan.flagged",
      severity: "high",
      details: { fileName: "other.pdf" },
    });
  } finally {
    unsubscribeUser();
    unsubscribeOtherUser();
    unsubscribeAdmin();
  }

  assert.equal(userMessages.length, 1);
  assert.equal(otherUserMessages.length, 1);
  assert.equal(adminMessages.length, 2);
  assert.match(userMessages[0], /event: activity/);
  assert.match(userMessages[0], /"fileName":"report\.pdf"/);
  assert.match(otherUserMessages[0], /"fileName":"other\.pdf"/);
  assert.doesNotMatch(otherUserMessages[0], /report\.pdf/);
  assert.doesNotMatch(userMessages[0], /private@example\.com|192\.0\.2\.1|"reason"/);
});

test("monitoring stream requires bearer authentication", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/monitoring`);
  assert.equal(response.status, 401);
});

const subscribers = new Set();

function referenceId(value) {
  if (!value) return "";
  return String(value._id || value);
}

function subscribeToMonitoring(user, response) {
  const subscriber = { userId: referenceId(user.id || user._id), role: user.role, response };
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function publishMonitoringEvent(activity) {
  const actorId = referenceId(activity.actorId);
  const targetUserId = referenceId(activity.targetUserId);
  const payload = {
    id: referenceId(activity.id || activity._id),
    event: activity.event,
    severity: activity.severity || "info",
    date: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : new Date().toISOString(),
    details: {
      fileName: typeof activity.details?.fileName === "string" ? activity.details.fileName : "",
      securityStatus: typeof activity.details?.securityStatus === "string" ? activity.details.securityStatus : "",
    },
  };
  const message = `id: ${payload.id}\nevent: activity\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const subscriber of subscribers) {
    const isAdministrator = subscriber.role === "admin" || subscriber.role === "superadmin";
    if (!isAdministrator && subscriber.userId !== actorId && subscriber.userId !== targetUserId) continue;
    if (subscriber.response.destroyed || subscriber.response.writableEnded) {
      subscribers.delete(subscriber);
      continue;
    }
    subscriber.response.write(message);
  }
}

module.exports = { publishMonitoringEvent, subscribeToMonitoring };

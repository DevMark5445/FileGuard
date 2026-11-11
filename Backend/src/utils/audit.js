const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const SystemSetting = require("../models/SystemSetting");
const SecurityAlert = require("../models/SecurityAlert");
const nodemailer = require("nodemailer");

async function recordActivity(req, entry) {
  const { _id, id, email } = req.user || {};
  const activity = await ActivityLog.create({
    ...entry,
    actorId: entry.actorId || _id || id || null,
    actorEmail: entry.actorEmail || email || "",
    ip: req.ip || "",
    userAgent: req.get("user-agent") || "",
  });

  const maliciousDetection = entry.details?.securityStatus === "malicious" ||
    entry.details?.malwareStatus === "infected";
  const flaggedVerification = entry.event === "file.verified" && maliciousDetection;
  const alertEvent = ["file.modified", "file.scan.flagged", "auth.login.failed", "auth.mfa.failed"].includes(entry.event);
  if (alertEvent || flaggedVerification) {
    await SecurityAlert.create({
      sourceActivity: activity.id,
      severity: entry.severity === "high" ? "high" : "warning",
    });
  }

  const notify = entry.severity === "high" || alertEvent || flaggedVerification;
  const smtpConfigured = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]
    .every((key) => process.env[key]);
  if (!notify || !smtpConfigured) return activity;

  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    if (settings?.securityNotifications === false) return activity;
    const recipients = await User.find({ role: { $in: ["admin", "superadmin"] }, status: "active" }).distinct("email");
    if (!recipients.length) return activity;

    const port = Number(process.env.SMTP_PORT);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    const summary = entry.event === "file.scan.flagged" || maliciousDetection
      ? `FileGuard flagged ${entry.details?.fileName || "an uploaded file"} for review after a security check. Review the scan history and security alerts.`
      : entry.details?.fileName
        ? `A file integrity check detected a change to ${entry.details.fileName}. A hash mismatch indicates changed content, not necessarily an attack.`
        : `FileGuard recorded a security event: ${entry.event}.`;
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: recipients,
      subject: "FileGuard security notification",
      text: `${summary}\n\nReview the security alerts in the FileGuard admin dashboard.`,
    });
  } catch (error) {
    console.error("Could not send FileGuard security notification:", error.message);
  }
  return activity;
}

module.exports = { recordActivity };

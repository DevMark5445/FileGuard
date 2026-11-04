const mongoose = require("mongoose");
const User = require("../models/User");
const FileRecord = require("../models/FileRecord");
const ActivityLog = require("../models/ActivityLog");
const SecurityAlert = require("../models/SecurityAlert");
const SecurityIncident = require("../models/SecurityIncident");
const SystemSetting = require("../models/SystemSetting");
const { formatFile } = require("./fileController");
const { recordActivity } = require("../utils/audit");
const { removeStoredFile } = require("../utils/fileStorage");

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  created: user.createdAt.toISOString(),
  lastUpdated: user.updatedAt.toISOString(),
});

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 500) : fallback;
}

function parseSkip(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), 1000000) : 0;
}

function referenceId(value) {
  if (!value) return null;
  if (typeof value === "object") return value._id?.toString() || value.id || null;
  return value.toString();
}

async function getOverview(req, res, next) {
  try {
    const [totalUsers, activeUsers, admins, superadmins, totalFiles, modifiedFiles, verified, modified, openIncidents, recentActivity] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "active" }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "superadmin" }),
      FileRecord.countDocuments(),
      FileRecord.countDocuments({ latestStatus: "modified" }),
      ActivityLog.countDocuments({ event: "file.verified" }),
      ActivityLog.countDocuments({ event: "file.modified" }),
      SecurityIncident.countDocuments({ status: { $ne: "resolved" } }),
      ActivityLog.find().sort({ createdAt: -1 }).limit(12).populate("actorId", "name email"),
    ]);

    return res.json({
      stats: { totalUsers, activeUsers, admins, superadmins, totalFiles, modifiedFiles, verified, modified, openIncidents },
      recentActivity: recentActivity.map(formatActivity),
    });
  } catch (error) {
    return next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const filter = {};
    if (req.user.role === "admin") {
      if (req.query.role !== undefined && req.query.role !== "user") {
        return res.status(403).json({ message: "Administrators can only view standard user accounts." });
      }
      filter.role = "user";
    }
    if (req.query.role !== undefined) {
      if (!["user", "admin", "superadmin"].includes(req.query.role)) {
        return res.status(400).json({ message: "Choose a valid user role filter." });
      }
      filter.role = req.query.role;
    }
    if (req.query.status !== undefined) {
      if (!["active", "deactivated", "suspended"].includes(req.query.status)) {
        return res.status(400).json({ message: "Choose a valid account status filter." });
      }
      filter.status = req.query.status;
    }
    if (req.query.query !== undefined &&
        (typeof req.query.query !== "string" || req.query.query.length > 100)) {
      return res.status(400).json({ message: "Search text must be 100 characters or fewer." });
    }
    if (typeof req.query.query === "string" && req.query.query.trim()) {
      const escaped = req.query.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: new RegExp(escaped, "i") },
        { email: new RegExp(escaped, "i") },
      ];
    }
    const limit = parseLimit(req.query.limit);
    const skip = parseSkip(req.query.skip);
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return res.json({ users: users.map(publicUser), total, limit, skip });
  } catch (error) {
    return next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User account not found." });
    if (req.user.role === "admin" && user.role !== "user") {
      return res.status(404).json({ message: "User account not found." });
    }
    const [fileCount, activity] = await Promise.all([
      FileRecord.countDocuments({ owner: user.id }),
      ActivityLog.find({ $or: [{ actorId: user.id }, { targetUserId: user.id }] })
        .sort({ createdAt: -1 }).limit(20),
    ]);
    return res.json({
      user: publicUser(user),
      fileCount,
      recentActivity: activity.map(formatActivity),
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "User account not found." });
    return next(error);
  }
}

async function updateUserStatus(req, res, next) {
  const { status, reason = "" } = req.body || {};
  if (!["active", "deactivated", "suspended"].includes(status)) {
    return res.status(400).json({ message: "Status must be active, deactivated, or suspended." });
  }
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) {
    return res.status(400).json({ message: "A status-change reason of 1–500 characters is required." });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot change your own account status." });
  }

  try {
    const target = await User.findById(req.params.id);
    if (!target || target.role === "superadmin" ||
        (req.user.role === "admin" && target.role !== "user")) {
      return res.status(404).json({ message: "Manageable user account not found." });
    }
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: req.user.role === "admin" ? "user" : { $ne: "superadmin" } },
      { $set: { status }, $inc: { tokenVersion: 1 } },
      { new: true, runValidators: true }
    ).select("+tokenVersion");
    if (!user) return res.status(404).json({ message: "Manageable user account not found." });
    await recordActivity(req, {
      event: "user.status.updated",
      severity: status === "active" ? "info" : "warning",
      targetUserId: user.id,
      details: { status, reason: reason.trim() },
    });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Manageable user account not found." });
    return next(error);
  }
}

async function updateUserRole(req, res, next) {
  const { role } = req.body || {};
  if (!["user", "admin"].includes(role)) {
    return res.status(400).json({ message: "Role must be user or admin. Super-admin privileges cannot be assigned." });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot change your own role." });
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: { $ne: "superadmin" } },
      { $set: { role }, $inc: { tokenVersion: 1 } },
      { new: true, runValidators: true }
    ).select("+tokenVersion");
    if (!user) return res.status(404).json({ message: "Manageable user account not found." });
    await recordActivity(req, {
      event: "user.role.updated",
      severity: "warning",
      targetUserId: user.id,
      details: { role },
    });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Manageable user account not found." });
    return next(error);
  }
}

async function deleteUser(req, res, next) {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot delete your own account." });
  }
  try {
    const user = await User.findOne({ _id: req.params.id, role: { $ne: "superadmin" } });
    if (!user) return res.status(404).json({ message: "Manageable user account not found." });

    const files = await FileRecord.find({ owner: user.id }).select("_id storageKey");
    await Promise.all(files.filter((file) => file.storageKey).map((file) => removeStoredFile(file.storageKey)));
    const fileIds = files.map((file) => file._id);
    await Promise.all([
      FileRecord.deleteMany({ owner: user.id }),
      ActivityLog.updateMany(
          { $or: [{ actorId: user.id }, { targetUserId: user.id }, { targetFileId: { $in: fileIds } }] },
          { $unset: { actorId: "", targetUserId: "", targetFileId: "" }, $set: { actorEmail: "", details: { redacted: true } } }
      ),
      User.deleteOne({ _id: user.id }),
    ]);
    await recordActivity(req, {
      event: "user.deleted",
      severity: "warning",
      details: { deletedUserId: user.id },
    });
    return res.json({ message: "User and associated registered-file metadata deleted." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Manageable user account not found." });
    return next(error);
  }
}

async function listFiles(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit);
    const skip = parseSkip(req.query.skip);
    const [files, total] = await Promise.all([
      FileRecord.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate("owner", "name email"),
      FileRecord.countDocuments(),
    ]);
    return res.json({ files: files.map(formatFile), total, limit, skip });
  } catch (error) {
    return next(error);
  }
}

function formatActivity(log) {
  return {
    id: log.id,
    event: log.event,
    severity: log.severity,
    actorId: log.actorId?._id?.toString() || log.actorId?.toString() || null,
    actorName: log.actorId?.name || log.actorEmail || "System",
    actorEmail: log.actorId?.email || log.actorEmail || "",
    targetUserId: referenceId(log.targetUserId),
    targetFileId: referenceId(log.targetFileId),
    details: log.details || {},
    ip: log.ip,
    date: log.createdAt.toISOString(),
    archivedAt: log.archivedAt?.toISOString() || null,
  };
}

async function listActivity(req, res, next) {
  try {
    const filter = {};
    if (req.query.archived !== undefined &&
        !["true", "false"].includes(req.query.archived)) {
      return res.status(400).json({ message: "Archived must be true or false." });
    }
    if (req.query.severity !== undefined &&
        !["info", "warning", "high", "alerts"].includes(req.query.severity)) {
      return res.status(400).json({ message: "Choose a valid activity severity filter." });
    }
    if (req.query.event !== undefined &&
        (typeof req.query.event !== "string" || req.query.event.length > 80)) {
      return res.status(400).json({ message: "Choose a valid activity event filter." });
    }
    if (req.query.severity === "alerts") {
      filter.severity = { $in: ["warning", "high"] };
    } else if (["info", "warning", "high"].includes(req.query.severity)) {
      filter.severity = req.query.severity;
    }
    if (req.query.archived === "true") {
      filter.archivedAt = { $type: "date" };
    } else if (req.query.archived === "false" || req.query.severity !== "alerts") {
      filter.archivedAt = null;
    }
    if (typeof req.query.event === "string" && req.query.event) filter.event = req.query.event;
    const limit = parseLimit(req.query.limit);
    const skip = parseSkip(req.query.skip);
    const [activity, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("actorId", "name email"),
      ActivityLog.countDocuments(filter),
    ]);
    return res.json({ activity: activity.map(formatActivity), total, limit, skip });
  } catch (error) {
    return next(error);
  }
}

async function archiveActivity(req, res, next) {
  const { before } = req.body || {};
  if (Object.keys(req.body || {}).some((key) => key !== "before") ||
      typeof before !== "string" || !before.trim()) {
    return res.status(400).json({ message: "Provide a cutoff date to archive older activity." });
  }
  const cutoff = new Date(before);
  if (Number.isNaN(cutoff.getTime()) || cutoff.toISOString() !== before ||
      cutoff >= new Date()) {
    return res.status(400).json({ message: "The archive cutoff must be a valid date in the past." });
  }

  try {
    const result = await ActivityLog.updateMany(
      { createdAt: { $lt: cutoff }, archivedAt: null },
      { $set: { archivedAt: new Date(), archivedBy: req.user.id } }
    );
    const archivedCount = result.modifiedCount ?? result.nModified ?? 0;
    await recordActivity(req, {
      event: "activity.archived",
      severity: "warning",
      details: { archivedCount, cutoff: cutoff.toISOString() },
    });
    return res.json({ archivedCount, message: `${archivedCount} activity records archived and remain available in the archive.` });
  } catch (error) {
    return next(error);
  }
}

async function restoreActivity(req, res, next) {
  try {
    const activity = await ActivityLog.findOneAndUpdate(
      { _id: req.params.id, archivedAt: { $type: "date" } },
      { $set: { archivedAt: null, archivedBy: null } },
      { new: true }
    );
    if (!activity) return res.status(404).json({ message: "Archived activity record not found." });
    await recordActivity(req, {
      event: "activity.restored",
      severity: "warning",
      details: { activityId: activity.id, originalEvent: activity.event },
    });
    return res.json({ message: "Activity record restored to the active log." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Archived activity record not found." });
    return next(error);
  }
}

async function listVerificationHistory(req, res, next) {
  try {
    const filter = { event: { $in: ["file.verified", "file.modified"] } };
    const limit = parseLimit(req.query.limit);
    const skip = parseSkip(req.query.skip);
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate("actorId", "name email role")
        .populate({ path: "targetUserId", select: "name email" })
        .populate({ path: "targetFileId", select: "name owner", populate: { path: "owner", select: "name email" } }),
      ActivityLog.countDocuments(filter),
    ]);
    const alerts = await SecurityAlert.find({
      sourceActivity: { $in: logs.map((log) => log.id) },
    }).select("sourceActivity status severity");
    const alertByActivity = new Map(alerts.map((alert) => [alert.sourceActivity.toString(), alert]));

    return res.json({
      history: logs.map((log) => {
        const alert = alertByActivity.get(log.id);
        return {
          id: log.id,
          fileId: log.targetFileId?.id || null,
          fileName: log.details.fileName || log.targetFileId?.name || "Removed file",
          owner: log.targetFileId?.owner
            ? { id: log.targetFileId.owner.id, name: log.targetFileId.owner.name, email: log.targetFileId.owner.email }
            : log.targetUserId
              ? { id: log.targetUserId.id, name: log.targetUserId.name, email: log.targetUserId.email }
              : null,
          performedBy: log.actorId?.name || log.actorEmail || "Unknown",
          performedByEmail: log.actorId?.email || log.actorEmail || "",
          date: log.createdAt.toISOString(),
          result: log.details.result || (log.event === "file.modified" ? "modified" : "intact"),
          originalHash: log.details.storedHash || "",
          checkedHash: log.details.newHash || "",
          alert: alert ? { id: alert.id, status: alert.status, severity: alert.severity } : null,
        };
      }),
      total,
      limit,
      skip,
    });
  } catch (error) {
    return next(error);
  }
}

async function listAlerts(req, res, next) {
  try {
    const filter = {};
    if (req.query.status !== undefined) {
      if (!["open", "investigating", "resolved"].includes(req.query.status)) {
        return res.status(400).json({ message: "Choose a valid alert status filter." });
      }
      filter.status = req.query.status;
    }
    if (req.query.severity !== undefined) {
      if (!["warning", "high"].includes(req.query.severity)) {
        return res.status(400).json({ message: "Choose a valid alert severity filter." });
      }
      filter.severity = req.query.severity;
    }
    const limit = parseLimit(req.query.limit);
    const skip = parseSkip(req.query.skip);
    const [alerts, total] = await Promise.all([
      SecurityAlert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("notes.author", "name email"),
      SecurityAlert.countDocuments(filter),
    ]);
    const activities = await ActivityLog.find({
      _id: { $in: alerts.map((alert) => alert.sourceActivity) },
    })
      .populate("actorId", "name email role")
      .populate("targetUserId", "name email role")
      .populate({ path: "targetFileId", select: "name hash latestStatus owner", populate: { path: "owner", select: "name email" } });
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));

    return res.json({
      alerts: alerts.map((alert) => {
        const activity = activityById.get(alert.sourceActivity.toString());
        return {
          id: alert.id,
          status: alert.status,
          severity: alert.severity,
          escalatedAt: alert.escalatedAt?.toISOString() || null,
          notes: alert.notes,
          created: alert.createdAt.toISOString(),
          activity: activity ? formatActivity(activity) : null,
        };
      }),
      total,
      limit,
      skip,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAlert(req, res, next) {
  const { status, note, escalate } = req.body || {};
  if (!["open", "investigating", "resolved"].includes(status)) {
    return res.status(400).json({ message: "Alert status must be open, investigating, or resolved." });
  }
  if (typeof note !== "string" || !note.trim() || note.length > 2000) {
    return res.status(400).json({ message: "Add an investigation note of 1–2,000 characters." });
  }
  if (escalate !== undefined && typeof escalate !== "boolean") {
    return res.status(400).json({ message: "Escalation must be a boolean value." });
  }
  try {
    const alert = await SecurityAlert.findById(req.params.id);
    if (!alert) return res.status(404).json({ message: "Security alert not found." });
    alert.status = status;
    alert.resolvedAt = status === "resolved" ? new Date() : null;
    alert.notes.push({ author: req.user.id, text: note.trim() });
    if (escalate) alert.escalatedAt = new Date();
    await alert.save();

    const activity = await ActivityLog.findById(alert.sourceActivity);
    await recordActivity(req, {
      event: "security.alert.updated",
      severity: escalate ? "high" : "warning",
      targetFileId: activity?.targetFileId || null,
      targetUserId: activity?.targetUserId || null,
      details: { alertId: alert.id, status, escalated: Boolean(escalate) },
    });
    return res.json({ message: escalate ? "Alert updated and escalated to the super admin." : "Alert investigation updated." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Security alert not found." });
    return next(error);
  }
}

async function listIncidents(req, res, next) {
  try {
    const incidents = await SecurityIncident.find().sort({ updatedAt: -1 })
      .populate("createdBy", "name email")
      .populate("notes.author", "name email")
      .populate("affectedUsers", "name email role status")
      .populate("affectedFiles", "name latestStatus owner");
    return res.json({ incidents });
  } catch (error) {
    return next(error);
  }
}

async function createIncident(req, res, next) {
  const { title, description, severity = "medium", affectedUsers = [], affectedFiles = [] } = req.body || {};
  if (typeof title !== "string" || !title.trim() || title.trim().length > 160) {
    return res.status(400).json({ message: "Incident title is required and must be 160 characters or fewer." });
  }
  if (typeof description !== "string" || !description.trim() || description.trim().length > 4000) {
    return res.status(400).json({ message: "Incident description is required and must be 4,000 characters or fewer." });
  }
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    return res.status(400).json({ message: "Choose a valid incident severity." });
  }
  if (!Array.isArray(affectedUsers) || affectedUsers.length > 50 ||
      !Array.isArray(affectedFiles) || affectedFiles.length > 100 ||
      [...affectedUsers, ...affectedFiles].some((id) => typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id))) {
    return res.status(400).json({ message: "Affected account and file references must be valid IDs." });
  }
  try {
    const [existingUsers, existingFiles] = await Promise.all([
      User.countDocuments({ _id: { $in: affectedUsers } }),
      FileRecord.countDocuments({ _id: { $in: affectedFiles } }),
    ]);
    if (existingUsers !== new Set(affectedUsers).size || existingFiles !== new Set(affectedFiles).size) {
      return res.status(400).json({ message: "One or more affected account or file IDs do not exist." });
    }
    const incident = await SecurityIncident.create({
      title: title.trim(),
      description: description.trim(),
      severity,
      affectedUsers: [...new Set(affectedUsers)],
      affectedFiles: [...new Set(affectedFiles)],
      createdBy: req.user.id,
    });
    await recordActivity(req, {
      event: "incident.created",
      severity: severity === "critical" || severity === "high" ? "high" : "info",
      details: { incidentId: incident.id, title: incident.title },
    });
    return res.status(201).json({ incident });
  } catch (error) {
    return next(error);
  }
}

async function updateIncident(req, res, next) {
  const { status, note } = req.body || {};
  if (!["open", "investigating", "resolved"].includes(status)) {
    return res.status(400).json({ message: "Choose a valid incident status." });
  }
  if (note !== undefined && (typeof note !== "string" || !note.trim() || note.length > 2000)) {
    return res.status(400).json({ message: "Investigation notes must be 1–2,000 characters." });
  }
  try {
    const incident = await SecurityIncident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: "Security incident not found." });
    incident.status = status;
    incident.resolvedAt = status === "resolved" ? new Date() : null;
    if (note) incident.notes.push({ author: req.user.id, text: note.trim() });
    await incident.save();
    await recordActivity(req, {
      event: "incident.updated",
      details: { incidentId: incident.id, status, noteAdded: Boolean(note) },
    });
    return res.json({ incident });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Security incident not found." });
    return next(error);
  }
}

const defaultSettings = {
  permittedFileTypes: ["*"],
  maximumFileSize: 50 * 1024 * 1024,
  sessionTimeoutMinutes: 24 * 60,
  securityNotifications: true,
  minimumPasswordLength: 8,
  passwordRequiresLetterAndNumber: true,
};

async function getSettings(req, res, next) {
  try {
    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      { $setOnInsert: { key: "global" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json({ settings: { ...defaultSettings, ...settings.toObject(), id: settings.id } });
  } catch (error) {
    return next(error);
  }
}

async function updateSettings(req, res, next) {
  const body = req.body || {};
  const {
    permittedFileTypes,
    maximumFileSize,
    sessionTimeoutMinutes,
    securityNotifications,
    minimumPasswordLength,
    passwordRequiresLetterAndNumber,
  } = body;

  if (!Array.isArray(permittedFileTypes) || permittedFileTypes.length > 100 ||
      permittedFileTypes.some((type) => typeof type !== "string" || !/^(?:\*|\.[a-z\d]{1,12})$/i.test(type))) {
    return res.status(400).json({ message: "File types must be `*` or extensions such as `.pdf`." });
  }
  if (!Number.isSafeInteger(maximumFileSize) || maximumFileSize < 1 || maximumFileSize > 1024 * 1024 * 1024) {
    return res.status(400).json({ message: "Maximum file size must be between 1 byte and 1 GB." });
  }
  if (!Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes < 5 || sessionTimeoutMinutes > 30 * 24 * 60) {
    return res.status(400).json({ message: "Session timeout must be between 5 minutes and 30 days." });
  }
  if (typeof securityNotifications !== "boolean" ||
      !Number.isInteger(minimumPasswordLength) || minimumPasswordLength < 8 || minimumPasswordLength > 128 ||
      typeof passwordRequiresLetterAndNumber !== "boolean") {
    return res.status(400).json({ message: "Review the security notification and account policy values." });
  }

  try {
    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      { $set: {
        permittedFileTypes: [...new Set(permittedFileTypes.map((type) => type.toLowerCase()))],
        maximumFileSize,
        sessionTimeoutMinutes,
        securityNotifications,
        minimumPasswordLength,
        passwordRequiresLetterAndNumber,
      } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await recordActivity(req, {
      event: "settings.updated",
      severity: "warning",
      details: { changedSettings: Object.keys(body) },
    });
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
}

async function exportReport(req, res, next) {
  try {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if ((req.query.from && typeof req.query.from !== "string") ||
        (req.query.to && typeof req.query.to !== "string")) {
      return res.status(400).json({ message: "Choose a valid report start and end date." });
    }
    const from = req.query.from ? new Date(req.query.from) : defaultFrom;
    const to = req.query.to ? new Date(req.query.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({ message: "Choose a valid report start and end date." });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "")) to.setUTCDate(to.getUTCDate() + 1);
    const range = { $gte: from, $lt: to };
    const adminIds = await User.find({ role: { $in: ["admin", "superadmin"] } }).distinct("_id");
    const [users, files, activity, incidents, alerts] = await Promise.all([
      User.countDocuments(),
      FileRecord.countDocuments(),
      ActivityLog.aggregate([
        { $match: { event: { $in: ["file.verified", "file.modified"] }, createdAt: range } },
        { $group: { _id: "$event", count: { $sum: 1 } } },
      ]),
      SecurityIncident.countDocuments({ createdAt: range }),
      SecurityAlert.countDocuments({ createdAt: range }),
    ]);
    const [newUsers, newFiles] = await Promise.all([
      User.countDocuments({ createdAt: range }),
      FileRecord.countDocuments({ createdAt: range }),
    ]);
    const verificationCounts = Object.fromEntries(activity.map(({ _id, count }) => [_id, count]));
    const adminActivities = await ActivityLog.countDocuments({
      actorId: { $in: adminIds },
      createdAt: range,
      event: { $in: ["admin.created", "admin.access.reset_requested", "user.status.updated", "user.role.updated", "user.deleted", "settings.updated", "incident.created", "incident.updated", "auth.mfa.enabled", "auth.mfa.setup.started"] },
    });
    const rows = [
      ["Metric", "Value"],
      ["Report period start", from.toISOString()],
      ["Report period end", to.toISOString()],
      ["Registered users (total)", users],
      ["New registrations in period", newUsers],
      ["Monitored files (total)", files],
      ["Files registered in period", newFiles],
      ["Successful verifications", verificationCounts["file.verified"] || 0],
      ["Detected modifications", verificationCounts["file.modified"] || 0],
      ["Security incidents", incidents],
      ["Security alerts", alerts],
      ["Administrator activities", adminActivities],
      ["Report generated at", now.toISOString()],
    ];
    const csv = rows.map((row) => row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="fileguard-report.csv"');
    return res.send(csv);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getOverview,
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  listFiles,
  listActivity,
  archiveActivity,
  restoreActivity,
  listVerificationHistory,
  listAlerts,
  updateAlert,
  listIncidents,
  createIncident,
  updateIncident,
  getSettings,
  updateSettings,
  exportReport,
};

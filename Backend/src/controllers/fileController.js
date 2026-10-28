const FileRecord = require("../models/FileRecord");
const ActivityLog = require("../models/ActivityLog");
const SystemSetting = require("../models/SystemSetting");
const { recordActivity } = require("../utils/audit");

function formatFile(file) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    hash: file.hash,
    date: file.createdAt.toISOString(),
    latestStatus: file.latestStatus,
    verificationCount: file.verificationCount,
    owner: file.owner && file.owner.name
      ? { id: file.owner.id, name: file.owner.name, email: file.owner.email }
      : undefined,
  };
}

async function getFilePolicy(req, res, next) {
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    return res.json({
      maximumFileSize: settings?.maximumFileSize ?? 50 * 1024 * 1024,
      permittedFileTypes: settings?.permittedFileTypes ?? ["*"],
    });
  } catch (error) {
    return next(error);
  }
}

async function getFiles(req, res, next) {
  try {
    const files = await FileRecord.find({ owner: req.user.id }).sort({ createdAt: -1 });
    return res.json({ files: files.map(formatFile) });
  } catch (error) {
    return next(error);
  }
}

async function registerFile(req, res, next) {
  const { name, size, hash } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 255) {
    return res.status(400).json({ message: "File name is required and must be 255 characters or fewer." });
  }
  if (!Number.isSafeInteger(size) || size < 1) {
    return res.status(400).json({ message: "File size must be a positive whole number of bytes." });
  }
  if (typeof hash !== "string" || !/^[a-f\d]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "A valid SHA-256 file fingerprint is required." });
  }

  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const maxSize = settings?.maximumFileSize ?? 50 * 1024 * 1024;
    if (size > maxSize) {
      return res.status(400).json({ message: `File exceeds the ${Math.floor(maxSize / (1024 * 1024))} MB system limit.` });
    }
    const permittedTypes = settings?.permittedFileTypes ?? ["*"];
    const extension = name.trim().includes(".") ? `.${name.trim().split(".").pop().toLowerCase()}` : "";
    if (!permittedTypes.includes("*") && !permittedTypes.includes(extension)) {
      return res.status(400).json({ message: "This file type is not permitted by system settings." });
    }

    const file = await FileRecord.create({
      name: name.trim(),
      size,
      hash: hash.toLowerCase(),
      owner: req.user.id,
    });
    await recordActivity(req, {
      event: "file.registered",
      targetFileId: file.id,
      details: { fileName: file.name, size: file.size },
    });
    return res.status(201).json({ file: formatFile(file) });
  } catch (error) {
    return next(error);
  }
}

async function importLegacyFiles(req, res, next) {
  const { files } = req.body || {};
  if (!Array.isArray(files) || files.length > 100) {
    return res.status(400).json({ message: "Import up to 100 legacy file records per request." });
  }
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const permittedTypes = settings?.permittedFileTypes ?? ["*"];
    const maxSize = settings?.maximumFileSize ?? 50 * 1024 * 1024;
    const imported = [];

    for (const item of files) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 255 ||
          !Number.isSafeInteger(item.size) || item.size < 1 ||
          item.size > maxSize || typeof item.hash !== "string" || !/^[a-f\d]{64}$/i.test(item.hash)) {
        return res.status(400).json({ message: "One or more saved file records have invalid metadata." });
      }
      const extension = item.name.trim().includes(".") ? `.${item.name.trim().split(".").pop().toLowerCase()}` : "";
      if (!permittedTypes.includes("*") && !permittedTypes.includes(extension)) {
        return res.status(400).json({ message: `${item.name} is not permitted by system settings.` });
      }
    }

    for (const item of files) {
      const name = item.name.trim();
      const hash = item.hash.toLowerCase();
      const existing = await FileRecord.findOne({ owner: req.user.id, name, hash });
      if (existing) continue;

      const file = await FileRecord.create({ name, size: item.size, hash, owner: req.user.id });
      imported.push(formatFile(file));
      await recordActivity(req, {
        event: "file.registered",
        targetFileId: file.id,
        details: { fileName: file.name, size: file.size, migrated: true },
      });
    }
    return res.json({ files: imported });
  } catch (error) {
    return next(error);
  }
}

async function deleteFile(req, res, next) {
  try {
    const file = await FileRecord.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
    if (!file) return res.status(404).json({ message: "That registered file could not be found." });
    await recordActivity(req, {
      event: "file.deleted",
      details: { fileName: file.name },
    });
    return res.json({ message: "File removed from monitoring." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function verifyFile(req, res, next) {
  const { hash } = req.body || {};
  if (typeof hash !== "string" || !/^[a-f\d]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "A valid SHA-256 file fingerprint is required." });
  }

  try {
    const file = await FileRecord.findOne({ _id: req.params.id, owner: req.user.id });
    if (!file) return res.status(404).json({ message: "That registered file could not be found." });

    const result = hash.toLowerCase() === file.hash ? "intact" : "modified";
    file.latestStatus = result;
    file.verificationCount += 1;
    await file.save();
    const newHash = hash.toLowerCase();
    const activity = await recordActivity(req, {
      event: result === "modified" ? "file.modified" : "file.verified",
      severity: result === "modified" ? "warning" : "info",
      targetFileId: file.id,
      details: { fileName: file.name, result, storedHash: file.hash, newHash },
    });

    return res.json({
      log: {
        id: activity.id,
        fileName: file.name,
        date: new Date().toISOString(),
        result,
        reviewed: false,
        storedHash: file.hash,
        newHash,
      },
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function adminVerifyFile(req, res, next) {
  const { hash, reason } = req.body || {};
  if (typeof hash !== "string" || !/^[a-f\d]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "A valid SHA-256 file fingerprint is required." });
  }
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    return res.status(400).json({ message: "A verification reason of 1–500 characters is required." });
  }

  try {
    const file = await FileRecord.findById(req.params.id).populate("owner", "name email");
    if (!file) return res.status(404).json({ message: "That registered file could not be found." });

    const result = hash.toLowerCase() === file.hash ? "intact" : "modified";
    file.latestStatus = result;
    file.verificationCount += 1;
    await file.save();
    const activity = await recordActivity(req, {
      event: result === "modified" ? "file.modified" : "file.verified",
      severity: result === "modified" ? "warning" : "info",
      targetFileId: file.id,
      targetUserId: file.owner.id,
      details: {
        fileName: file.name,
        result,
        storedHash: file.hash,
        newHash: hash.toLowerCase(),
        performedByRole: req.user.role,
        authorizedReason: reason.trim(),
      },
    });
    return res.json({
      log: {
        id: activity.id,
        fileName: file.name,
        date: activity.createdAt.toISOString(),
        result,
        storedHash: file.hash,
        newHash: hash.toLowerCase(),
        owner: { name: file.owner.name, email: file.owner.email },
      },
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function getHistory(req, res, next) {
  try {
    const logs = await ActivityLog.find({
      $or: [{ actorId: req.user.id }, { targetUserId: req.user.id }],
      event: { $in: ["file.modified", "file.verified"] },
    }).sort({ createdAt: -1 }).limit(500);
    return res.json({
      logs: logs.map((log) => ({
        id: log.id,
        fileName: log.details.fileName,
        date: log.createdAt.toISOString(),
        result: log.details.result,
        reviewed: Boolean(log.details.reviewed),
        storedHash: log.details.storedHash,
        newHash: log.details.newHash,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function reviewLog(req, res, next) {
  try {
    const log = await ActivityLog.findOne({
      _id: req.params.id,
      actorId: req.user.id,
      event: "file.modified",
    });
    if (!log) return res.status(404).json({ message: "That verification record could not be found." });
    log.details.reviewed = true;
    log.markModified("details");
    await log.save();
    await recordActivity(req, {
      event: "file.alert.reviewed",
      targetFileId: log.targetFileId,
      details: { fileName: log.details.fileName },
    });
    return res.json({ message: "Alert marked as reviewed." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That verification record could not be found." });
    return next(error);
  }
}

module.exports = { getFilePolicy, getFiles, registerFile, importLegacyFiles, deleteFile, verifyFile, adminVerifyFile, getHistory, reviewLog, formatFile };

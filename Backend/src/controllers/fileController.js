const FileRecord = require("../models/FileRecord");
const ActivityLog = require("../models/ActivityLog");
const SystemSetting = require("../models/SystemSetting");
const { recordActivity } = require("../utils/audit");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const { diffLines } = require("diff");
const { getStoredFilePath, removeStoredFile } = require("../utils/fileStorage");

const MAX_TEXT_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_LINES = 1000;
const CHANGED_COPY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function formatFile(file) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    hash: file.hash,
    date: file.createdAt.toISOString(),
    latestStatus: file.latestStatus,
    verificationCount: file.verificationCount,
    hasOriginalCopy: Boolean(file.storageKey),
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
      targetUserId: file.owner,
      targetFileId: file.id,
      details: { fileName: file.name, size: file.size },
    });
    return res.status(201).json({ file: formatFile(file) });
  } catch (error) {
    return next(error);
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function lineValues(value) {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function createTextDiff(originalBuffer, changedBuffer) {
  if (originalBuffer.length > MAX_TEXT_DIFF_BYTES || changedBuffer.length > MAX_TEXT_DIFF_BYTES ||
      originalBuffer.includes(0) || changedBuffer.includes(0)) {
    return { available: false, message: "A line-by-line comparison is unavailable for binary files or files larger than 2 MB. You can download the changed copy." };
  }

  let original;
  let changed;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    original = decoder.decode(originalBuffer);
    changed = decoder.decode(changedBuffer);
  } catch {
    return { available: false, message: "A line-by-line comparison is unavailable for binary files or files larger than 2 MB. You can download the changed copy." };
  }

  let oldLine = 1;
  let newLine = 1;
  const lines = [];
  let truncated = false;
  for (const part of diffLines(original, changed)) {
    const values = lineValues(part.value);
    for (const text of values) {
      if (part.removed || part.added) {
        if (lines.length < MAX_DIFF_LINES) {
          lines.push({
            type: part.added ? "added" : "removed",
            oldLine: part.added ? null : oldLine,
            newLine: part.removed ? null : newLine,
            text,
          });
        } else {
          truncated = true;
        }
      }
      if (!part.added) oldLine += 1;
      if (!part.removed) newLine += 1;
    }
  }
  return { available: true, lines, truncated };
}

async function getTextDiff(originalPath, changedPath) {
  const [originalStat, changedStat] = await Promise.all([
    fs.promises.stat(originalPath),
    fs.promises.stat(changedPath),
  ]);
  if (originalStat.size > MAX_TEXT_DIFF_BYTES || changedStat.size > MAX_TEXT_DIFF_BYTES) {
    return { available: false, message: "A line-by-line comparison is unavailable for binary files or files larger than 2 MB. You can download the changed copy." };
  }
  const [originalBuffer, changedBuffer] = await Promise.all([
    fs.promises.readFile(originalPath),
    fs.promises.readFile(changedPath),
  ]);
  return createTextDiff(originalBuffer, changedBuffer);
}

async function clearExpiredChangedCopy(log) {
  if (!log.changedFileKey || !log.changedFileExpiresAt ||
      log.changedFileExpiresAt.getTime() > Date.now()) {
    return false;
  }
  await removeStoredFile(log.changedFileKey);
  await ActivityLog.updateOne(
    { _id: log._id, changedFileKey: log.changedFileKey },
    { $unset: { changedFileKey: "", changedFileExpiresAt: "" } }
  );
  return true;
}

async function uploadFile(req, res, next) {
  let hash;
  try {
    hash = await hashFile(getStoredFilePath(req.file.filename));
  } catch (error) {
    return removeStoredFile(req.file.filename).then(() => next(error)).catch(next);
  }

  let file;
  try {
    file = await FileRecord.create({
      name: req.uploadOriginalName,
      size: req.file.size,
      hash,
      storageKey: req.file.filename,
      owner: req.user.id,
    });
  } catch (error) {
    return removeStoredFile(req.file.filename).then(() => next(error)).catch(next);
  }

  try {
    await recordActivity(req, {
      event: "file.registered",
      targetUserId: file.owner,
      targetFileId: file.id,
      details: { fileName: file.name, size: file.size, uploaded: true },
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
        targetUserId: file.owner,
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
    const existing = await FileRecord.findOne({ _id: req.params.id, owner: req.user.id });
    if (!existing) return res.status(404).json({ message: "That registered file could not be found." });
    if (existing.storageKey) await removeStoredFile(existing.storageKey);
    const file = await FileRecord.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
    if (!file) return res.status(404).json({ message: "That registered file could not be found." });
    await recordActivity(req, {
      event: "file.deleted",
      targetUserId: existing.owner,
      targetFileId: existing.id,
      details: { fileName: file.name },
    });
    return res.json({ message: "File removed from monitoring." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function verifyFile(req, res, next) {
  let keepUpload = false;
  try {
    const file = await FileRecord.findOne({ _id: req.params.id, owner: req.user.id });
    if (!file) {
      await removeStoredFile(req.file.filename);
      return res.status(404).json({ message: "That registered file could not be found." });
    }
    if (!file.storageKey) {
      await removeStoredFile(req.file.filename);
      return res.status(409).json({ message: "This older registration has no saved original file. Remove and register it again to enable change comparisons." });
    }

    const newHash = await hashFile(getStoredFilePath(req.file.filename));
    const result = newHash === file.hash ? "intact" : "modified";
    const diff = result === "modified"
      ? await getTextDiff(
        getStoredFilePath(file.storageKey),
        getStoredFilePath(req.file.filename)
      )
      : undefined;
    const changedFileExpiresAt = result === "modified"
      ? new Date(Date.now() + CHANGED_COPY_RETENTION_MS)
      : undefined;
    file.latestStatus = result;
    file.verificationCount += 1;
    await file.save();
    const activity = await recordActivity(req, {
      event: result === "modified" ? "file.modified" : "file.verified",
      severity: result === "modified" ? "warning" : "info",
      targetUserId: file.owner,
      targetFileId: file.id,
      details: { fileName: file.name, result, storedHash: file.hash, newHash },
      ...(result === "modified" ? {
        changedFileKey: req.file.filename,
        changedFileExpiresAt,
      } : {}),
    });
    if (result === "modified") keepUpload = true;
    else await removeStoredFile(req.file.filename);

    return res.json({
      log: {
        id: activity.id,
        fileName: file.name,
        date: activity.createdAt.toISOString(),
        result,
        reviewed: false,
        storedHash: file.hash,
        newHash,
        ...(diff ? { diff } : {}),
        changedCopyAvailable: result === "modified",
        ...(changedFileExpiresAt ? { changedFileExpiresAt: changedFileExpiresAt.toISOString() } : {}),
      },
    });
  } catch (error) {
    if (!keepUpload) {
      try {
        await removeStoredFile(req.file.filename);
      } catch (cleanupError) {
        return next(cleanupError);
      }
    }
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function adminVerifyFile(req, res, next) {
  const { reason } = req.body || {};
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    return removeStoredFile(req.file.filename)
      .then(() => res.status(400).json({ message: "A verification reason of 1–500 characters is required." }))
      .catch(next);
  }

  let keepUpload = false;
  try {
    const file = await FileRecord.findById(req.params.id).populate("owner", "name email");
    if (!file) {
      await removeStoredFile(req.file.filename);
      return res.status(404).json({ message: "That registered file could not be found." });
    }
    if (!file.storageKey) {
      await removeStoredFile(req.file.filename);
      return res.status(409).json({ message: "This older registration has no saved original file. Remove and register it again to enable change comparisons." });
    }

    const newHash = await hashFile(getStoredFilePath(req.file.filename));
    const result = newHash === file.hash ? "intact" : "modified";
    const diff = result === "modified"
      ? await getTextDiff(getStoredFilePath(file.storageKey), getStoredFilePath(req.file.filename))
      : undefined;
    const changedFileExpiresAt = result === "modified"
      ? new Date(Date.now() + CHANGED_COPY_RETENTION_MS)
      : undefined;
    file.latestStatus = result;
    file.verificationCount += 1;
    await file.save();
    const activity = await recordActivity(req, {
      event: result === "modified" ? "file.modified" : "file.verified",
      severity: result === "modified" ? "warning" : "info",
      targetFileId: file.id,
      targetUserId: file.owner.id,
      ...(result === "modified" ? {
        changedFileKey: req.file.filename,
        changedFileExpiresAt,
      } : {}),
      details: {
        fileName: file.name,
        result,
        storedHash: file.hash,
        newHash,
        performedByRole: req.user.role,
        authorizedReason: reason.trim(),
      },
    });
    if (result === "modified") keepUpload = true;
    else await removeStoredFile(req.file.filename);
    return res.json({
      log: {
        id: activity.id,
        fileName: file.name,
        date: activity.createdAt.toISOString(),
        result,
        storedHash: file.hash,
        newHash,
        owner: { name: file.owner.name, email: file.owner.email },
        ...(diff ? { diff } : {}),
        changedCopyAvailable: result === "modified",
        ...(changedFileExpiresAt ? { changedFileExpiresAt: changedFileExpiresAt.toISOString() } : {}),
      },
    });
  } catch (error) {
    if (!keepUpload) {
      try {
        await removeStoredFile(req.file.filename);
      } catch (cleanupError) {
        return next(cleanupError);
      }
    }
    if (error.name === "CastError") return res.status(404).json({ message: "That registered file could not be found." });
    return next(error);
  }
}

async function getHistory(req, res, next) {
  try {
    const fileIds = await FileRecord.find({ owner: req.user.id }).distinct("_id");
    const logs = await ActivityLog.find({
      $or: [
        { targetUserId: req.user.id },
        { actorId: req.user.id, targetFileId: { $in: fileIds } },
      ],
      event: { $in: ["file.modified", "file.verified"] },
    }).sort({ createdAt: -1 }).limit(500);
    const now = Date.now();
    return res.json({
      logs: logs.map((log) => ({
        id: log.id,
        fileName: log.details.fileName,
        date: log.createdAt.toISOString(),
        result: log.details.result,
        reviewed: Boolean(log.details.reviewed),
        storedHash: log.details.storedHash,
        newHash: log.details.newHash,
        hasChangedCopy: Boolean(log.changedFileKey) &&
          (!log.changedFileExpiresAt || log.changedFileExpiresAt.getTime() > now),
        changedCopyExpiresAt: log.changedFileExpiresAt?.toISOString(),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function getVerificationDiff(req, res, next) {
  try {
    const log = await ActivityLog.findOne({
      _id: req.params.id,
      targetUserId: req.user.id,
      event: "file.modified",
    });
    if (!log) return res.status(404).json({ message: "That verification record could not be found." });
    if (await clearExpiredChangedCopy(log)) {
      return res.status(404).json({ message: "The changed copy has expired and is no longer available." });
    }
    const file = await FileRecord.findOne({ _id: log.targetFileId, owner: req.user.id });
    if (!file?.storageKey || !log.changedFileKey) {
      return res.status(404).json({ message: "The original or changed copy is no longer available for comparison." });
    }
    const diff = await getTextDiff(
      getStoredFilePath(file.storageKey),
      getStoredFilePath(log.changedFileKey)
    );
    return res.json({ diff });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That verification record could not be found." });
    return next(error);
  }
}

async function downloadChangedFile(req, res, next) {
  try {
    const log = await ActivityLog.findOne({
      _id: req.params.id,
      targetUserId: req.user.id,
      event: "file.modified",
    });
    if (!log?.changedFileKey) {
      return res.status(404).json({ message: "That changed file could not be found." });
    }
    if (await clearExpiredChangedCopy(log)) {
      return res.status(404).json({ message: "The changed copy has expired and is no longer available." });
    }
    const filePath = getStoredFilePath(log.changedFileKey);
    return res.download(filePath, log.details.fileName || "changed-file", (error) => {
      if (error && !res.headersSent) return next(error);
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That changed file could not be found." });
    return next(error);
  }
}

async function reviewLog(req, res, next) {
  try {
    const fileIds = await FileRecord.find({ owner: req.user.id }).distinct("_id");
    const log = await ActivityLog.findOne({
      _id: req.params.id,
      $or: [
        { targetUserId: req.user.id },
        { actorId: req.user.id, targetFileId: { $in: fileIds } },
      ],
      event: "file.modified",
    });
    if (!log) return res.status(404).json({ message: "That verification record could not be found." });
    log.details.reviewed = true;
    log.markModified("details");
    await log.save();
    await recordActivity(req, {
      event: "file.alert.reviewed",
      targetUserId: log.targetUserId || log.actorId,
      targetFileId: log.targetFileId,
      details: { fileName: log.details.fileName },
    });
    return res.json({ message: "Alert marked as reviewed." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "That verification record could not be found." });
    return next(error);
  }
}

module.exports = { getFilePolicy, getFiles, registerFile, uploadFile, importLegacyFiles, deleteFile, verifyFile, adminVerifyFile, getHistory, getVerificationDiff, downloadChangedFile, reviewLog, formatFile, createTextDiff };

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const multer = require("multer");
const SystemSetting = require("../models/SystemSetting");
const { ensureStorageDirectory, removeStoredFile } = require("../utils/fileStorage");

function originalFileName(file) {
  return (file.originalname || "").replace(/\\/g, "/").split("/").pop().trim();
}

function uploadErrorResponse(error, req, res, next) {
  const respond = () => {
    if (error.code === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({ message: "This file type is not permitted by system settings." });
    }
    if (error.code === "INVALID_FILE_NAME") {
      return res.status(400).json({ message: "File name is required and must be 255 characters or fewer." });
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File exceeds the system size limit." });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: "Upload one file using the `file` field." });
    }
    return next(error);
  };

  if (!req.file) return respond();
  removeStoredFile(req.file.filename).then(respond).catch(next);
}

async function uploadFile(req, res, next) {
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const maximumFileSize = settings?.maximumFileSize ?? 50 * 1024 * 1024;
    const permittedFileTypes = (settings?.permittedFileTypes ?? ["*"]).map((type) => type.toLowerCase());
    const upload = multer({
      storage: multer.diskStorage({
        destination: async (request, file, callback) => {
          try {
            callback(null, await ensureStorageDirectory());
          } catch (error) {
            callback(error);
          }
        },
        filename: (request, file, callback) => {
          request.storageKey = randomUUID();
          callback(null, request.storageKey);
        },
      }),
      limits: { fileSize: maximumFileSize, files: 1, fields: 0 },
      fileFilter: (request, file, callback) => {
        const name = originalFileName(file);
        if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
          const error = new Error("Invalid uploaded file name.");
          error.code = "INVALID_FILE_NAME";
          return callback(error);
        }
        request.uploadOriginalName = name;
        const extension = path.extname(name).toLowerCase();
        if (!permittedFileTypes.includes("*") && !permittedFileTypes.includes(extension)) {
          const error = new Error("Unsupported uploaded file type.");
          error.code = "UNSUPPORTED_FILE_TYPE";
          return callback(error);
        }
        return callback(null, true);
      },
    }).single("file");

    upload(req, res, (error) => {
      if (error) return uploadErrorResponse(error, req, res, next);
      if (!req.file) return res.status(400).json({ message: "Choose a file to upload." });
      if (req.file.size < 1) {
        return removeStoredFile(req.file.filename)
          .then(() => res.status(400).json({ message: "File must not be empty." }))
          .catch(next);
      }
      fs.chmod(req.file.path, 0o600)
        .then(() => next())
        .catch((chmodError) => {
          removeStoredFile(req.file.filename).then(() => next(chmodError)).catch(next);
        });
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { uploadFile };

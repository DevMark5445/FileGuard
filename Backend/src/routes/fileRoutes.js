const express = require("express");
const {
  getFiles,
  getFilePolicy,
  registerFile,
  uploadFile: storeUploadedFile,
  importLegacyFiles,
  deleteFile,
  downloadFile,
  verifyFile,
  adminVerifyFile,
  getHistory,
  getVerificationDiff,
  downloadChangedFile,
  reviewLog,
} = require("../controllers/fileController");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { receiveFile, receiveFileWithReason } = require("../middleware/fileUpload");

const router = express.Router();
router.use(authenticateToken);
router.get("/policy", getFilePolicy);
router.get("/", getFiles);
router.post("/import", importLegacyFiles);
router.post("/upload", receiveFile, storeUploadedFile);
router.post("/", registerFile);
router.delete("/:id", deleteFile);
router.get("/:id/download", downloadFile);
router.post("/:id/verify", receiveFile, verifyFile);
router.post("/:id/admin-verify", requireRole("admin", "superadmin"), receiveFileWithReason, adminVerifyFile);
router.get("/history", getHistory);
router.get("/history/:id/diff", getVerificationDiff);
router.get("/history/:id/changed-copy", downloadChangedFile);
router.patch("/history/:id/review", reviewLog);

module.exports = router;

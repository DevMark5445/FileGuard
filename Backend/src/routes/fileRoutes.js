const express = require("express");
const {
  getFiles,
  getFilePolicy,
  registerFile,
  importLegacyFiles,
  deleteFile,
  verifyFile,
  adminVerifyFile,
  getHistory,
  reviewLog,
} = require("../controllers/fileController");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);
router.get("/policy", getFilePolicy);
router.get("/", getFiles);
router.post("/import", importLegacyFiles);
router.post("/", registerFile);
router.delete("/:id", deleteFile);
router.post("/:id/verify", verifyFile);
router.post("/:id/admin-verify", requireRole("admin", "superadmin"), adminVerifyFile);
router.get("/history", getHistory);
router.patch("/history/:id/review", reviewLog);

module.exports = router;

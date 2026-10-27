const express = require("express");
const {
  getFiles,
  getFilePolicy,
  registerFile,
  importLegacyFiles,
  deleteFile,
  verifyFile,
  getHistory,
  reviewLog,
} = require("../controllers/fileController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);
router.get("/policy", getFilePolicy);
router.get("/", getFiles);
router.post("/import", importLegacyFiles);
router.post("/", registerFile);
router.delete("/:id", deleteFile);
router.post("/:id/verify", verifyFile);
router.get("/history", getHistory);
router.patch("/history/:id/review", reviewLog);

module.exports = router;

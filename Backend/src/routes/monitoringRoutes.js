const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { streamMonitoring } = require("../controllers/monitoringController");

const router = express.Router();
router.get("/", authenticateToken, streamMonitoring);

module.exports = router;

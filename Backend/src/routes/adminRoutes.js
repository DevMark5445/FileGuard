const express = require("express");
const {
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
} = require("../controllers/adminController");
const { authenticateToken, requireRole } = require("../middleware/auth");
const {
  getMfaStatus,
  setupMfa,
  enableMfa,
  resetAdminAccess,
} = require("../controllers/authSecurityController");

const router = express.Router();
router.use(authenticateToken, requireRole("admin", "superadmin"));
router.get("/overview", getOverview);
router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.get("/files", listFiles);
router.get("/activity", listActivity);
router.post("/activity/archive", archiveActivity);
router.post("/activity/:id/restore", restoreActivity);
router.get("/verification-history", listVerificationHistory);
router.get("/alerts", listAlerts);
router.patch("/alerts/:id", updateAlert);
router.get("/incidents", listIncidents);
router.get("/settings", getSettings);
router.get("/mfa", requireRole("superadmin"), getMfaStatus);
router.post("/mfa/setup", requireRole("superadmin"), setupMfa);
router.post("/mfa/enable", requireRole("superadmin"), enableMfa);
router.get("/reports.csv", exportReport);
router.patch("/users/:id/status", updateUserStatus);
router.patch("/users/:id/role", requireRole("superadmin"), updateUserRole);
router.post("/users/:id/reset-access", requireRole("superadmin"), resetAdminAccess);
router.delete("/users/:id", requireRole("superadmin"), deleteUser);
router.post("/incidents", requireRole("superadmin"), createIncident);
router.patch("/incidents/:id", requireRole("superadmin"), updateIncident);
router.put("/settings", requireRole("superadmin"), updateSettings);

module.exports = router;

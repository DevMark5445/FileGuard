const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  register,
  login,
  createAdmin,
  getCurrentUser,
  logout,
} = require("../controllers/authController");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again in 15 minutes." },
});

router.post("/register", register);
router.post("/login", loginLimiter, login);
router.post("/admins", authenticateToken, requireRole("superadmin"), createAdmin);
router.get("/me", authenticateToken, getCurrentUser);
router.post("/logout", authenticateToken, logout);

module.exports = router;

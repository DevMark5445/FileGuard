const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const SystemSetting = require("../models/SystemSetting");
const { recordActivity } = require("../utils/audit");
const { passwordPolicyError } = require("../utils/passwordPolicy");
const { createMfaChallenge } = require("./authSecurityController");

const emailPattern = /^\S+@\S+\.\S+$/;

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status || "active",
    created: user.createdAt.toISOString(),
  };
}

function validateCredentials({ name, email, password }, includeName, settings) {
  if (includeName && (typeof name !== "string" || !name.trim())) {
    return "Enter your full name.";
  }
  if (includeName && name.trim().length > 100) {
    return "Name must be 100 characters or fewer.";
  }
  if (typeof email !== "string" || !emailPattern.test(email.trim())) {
    return "Enter a valid email address.";
  }
  if (email.trim().length > 254) {
    return "Email must be 254 characters or fewer.";
  }
  if (typeof password !== "string") {
    return "Enter your password.";
  }
  return passwordPolicyError(password, settings);
}

async function createToken(user) {
  const settings = await SystemSetting.findOne({ key: "global" });
  const expiresIn = Math.max(300, (settings?.sessionTimeoutMinutes || 24 * 60) * 60);
  return jwt.sign(
    { ver: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn }
  );
}

async function register(req, res, next) {
  const { name, email, password } = req.body || {};
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const validationError = validateCredentials({ name, email, password }, true, settings);
    if (validationError) return res.status(400).json({ message: validationError });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: "user",
    });
    await recordActivity(req, {
      event: "auth.registered",
      actorId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
      details: { role: user.role },
    });
    const token = await createToken(user);
    return res.status(201).json({ user: publicUser(user), token });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    }
    return next(error);
  }
}

async function login(req, res, next) {
  const { email, password } = req.body || {};
  const validationError = validateCredentials({ email, password }, false);
  try {
    if (validationError) {
      await recordActivity(req, {
        event: "auth.login.failed",
        severity: "warning",
        actorEmail: typeof email === "string" ? email.trim().toLowerCase() : "",
        details: { reason: "invalid_request" },
      });
      return res.status(400).json({ message: validationError });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() })
      .select("+passwordHash +tokenVersion +mfaSecret");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await recordActivity(req, {
        event: "auth.login.failed",
        severity: "warning",
        actorEmail: typeof email === "string" ? email.trim().toLowerCase() : "",
        targetUserId: user?.id || null,
        details: { reason: "invalid_credentials" },
      });
      return res.status(401).json({ message: "Email or password is incorrect." });
    }
    if (user.status !== "active") {
      await recordActivity(req, {
        event: "auth.login.failed",
        severity: "high",
        actorId: user.id,
        actorEmail: user.email,
        targetUserId: user.id,
        details: { reason: user.status },
      });
      return res.status(403).json({ message: "This account is not active. Contact a FileGuard administrator." });
    }
    if (user.role === "superadmin" && user.mfaEnabled) {
      await recordActivity(req, {
        event: "auth.login.mfa_challenge",
        actorId: user.id,
        actorEmail: user.email,
        targetUserId: user.id,
      });
      return res.json({ mfaRequired: true, challengeToken: createMfaChallenge(user) });
    }

    await recordActivity(req, {
      event: "auth.login.succeeded",
      actorId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
    });
    return res.json({ user: publicUser(user), token: await createToken(user) });
  } catch (error) {
    return next(error);
  }
}

async function createAdmin(req, res, next) {
  const { name, email, password } = req.body || {};
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const validationError = validateCredentials({ name, email, password }, true, settings);
    if (validationError) return res.status(400).json({ message: validationError });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
    });
    await recordActivity(req, {
      event: "admin.created",
      severity: "warning",
      targetUserId: user.id,
      details: { email: user.email },
    });
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }
    return next(error);
  }
}

async function getCurrentUser(req, res) {
  return res.json({ user: publicUser(req.user) });
}

async function logout(req, res, next) {
  try {
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
    await recordActivity(req, { event: "auth.logout", targetUserId: req.user.id });
    return res.json({ message: "Signed out successfully." });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, createAdmin, getCurrentUser, logout };

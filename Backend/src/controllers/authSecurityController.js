const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const speakeasy = require("speakeasy");
const User = require("../models/User");
const SystemSetting = require("../models/SystemSetting");
const { recordActivity } = require("../utils/audit");
const { passwordPolicyError } = require("../utils/passwordPolicy");
const { decryptSecret, encryptSecret } = require("../utils/encryptedSecret");

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

function mailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    return null;
  }
  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  return {
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    }),
    from: SMTP_FROM,
  };
}

async function issuePasswordResetEmail(user) {
  const mail = mailTransport();
  if (!mail) return false;

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  const origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const resetUrl = new URL("/reset-password", origin);
  resetUrl.searchParams.set("token", rawToken);
  try {
    await mail.transporter.sendMail({
      from: mail.from,
      to: user.email,
      subject: "Reset your FileGuard password",
      text: `Use this link within 30 minutes to reset your FileGuard password:\n\n${resetUrl.toString()}\n\nIf you did not request this, ignore this email.`,
    });
  } catch (error) {
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    throw error;
  }
  return true;
}

async function requestPasswordReset(req, res, next) {
  const email = req.body?.email;
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  try {
    if (!mailTransport()) {
      return res.status(503).json({ message: "Account recovery email is not configured. Contact your system administrator." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase(), status: "active" });
    if (user) {
      await issuePasswordResetEmail(user);
      await recordActivity(req, {
        event: "auth.password.reset_requested",
        actorId: user.id,
        actorEmail: user.email,
        targetUserId: user.id,
      });
    }
    return res.json({ message: "If an active account matches that email, a recovery link has been sent." });
  } catch (error) {
    return next(error);
  }
}

async function resetAdminAccess(req, res, next) {
  try {
    const user = await User.findOne({ _id: req.params.id, role: "admin", status: "active" })
      .select("+passwordResetTokenHash +passwordResetExpires");
    if (!user) return res.status(404).json({ message: "Active administrator account not found." });
    if (!(await issuePasswordResetEmail(user))) {
      return res.status(503).json({ message: "Account recovery email is not configured. Contact your system administrator." });
    }
    await recordActivity(req, {
      event: "admin.access.reset_requested",
      severity: "warning",
      targetUserId: user.id,
    });
    return res.json({ message: "A secure, single-use recovery link was sent to the administrator." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Active administrator account not found." });
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  const { token, password } = req.body || {};
  if (typeof token !== "string" || !/^[a-f\d]{64}$/i.test(token)) {
    return res.status(400).json({ message: "This password-reset link is invalid or has expired." });
  }
  try {
    const settings = await SystemSetting.findOne({ key: "global" });
    const policyError = passwordPolicyError(password, settings);
    if (policyError) return res.status(400).json({ message: policyError });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
      status: "active",
    }).select("+passwordResetTokenHash +passwordResetExpires +tokenVersion");
    if (!user) return res.status(400).json({ message: "This password-reset link is invalid or has expired." });

    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    user.tokenVersion += 1;
    await user.save();
    await recordActivity(req, {
      event: "auth.password.reset",
      actorId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
      severity: "warning",
    });
    return res.json({ message: "Password reset successfully. Sign in with your new password." });
  } catch (error) {
    return next(error);
  }
}

async function verifyMfa(req, res, next) {
  const { challengeToken, code } = req.body || {};
  if (typeof challengeToken !== "string" || typeof code !== "string") {
    return res.status(400).json({ message: "Enter your authenticator code." });
  }
  try {
    const payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    if (payload.purpose !== "mfa" || typeof payload.sub !== "string") {
      return res.status(401).json({ message: "Your sign-in challenge is invalid or expired." });
    }
    const user = await User.findById(payload.sub).select("+mfaSecret +mfaRecoveryCodeHashes +tokenVersion");
    if (!user || user.role !== "superadmin" || user.status !== "active" ||
        !user.mfaEnabled || user.tokenVersion !== payload.ver) {
      return res.status(401).json({ message: "Your sign-in challenge is invalid or expired." });
    }

    let valid = speakeasy.totp.verify({
      secret: decryptSecret(user.mfaSecret),
      encoding: "base32",
      token: code.replace(/\s/g, ""),
      window: 1,
    });
    if (!valid) {
      const recoveryHash = crypto.createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
      const index = user.mfaRecoveryCodeHashes.indexOf(recoveryHash);
      if (index >= 0) {
        user.mfaRecoveryCodeHashes.splice(index, 1);
        await user.save();
        valid = true;
      }
    }
    if (!valid) {
      await recordActivity(req, {
        event: "auth.mfa.failed",
        severity: "high",
        actorId: user.id,
        actorEmail: user.email,
        targetUserId: user.id,
      });
      return res.status(401).json({ message: "That authenticator code is incorrect." });
    }

    await recordActivity(req, {
      event: "auth.login.succeeded",
      actorId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
      details: { mfa: true },
    });
    const settings = await SystemSetting.findOne({ key: "global" });
    const expiresIn = Math.max(300, (settings?.sessionTimeoutMinutes || 24 * 60) * 60);
    const token = jwt.sign(
      { ver: user.tokenVersion ?? 0 },
      process.env.JWT_SECRET,
      { subject: user.id, expiresIn }
    );
    return res.json({ user: publicUser(user), token });
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Your sign-in challenge is invalid or expired." });
    }
    return next(error);
  }
}

async function getMfaStatus(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select("+mfaPendingSecret");
    return res.json({ enabled: Boolean(user.mfaEnabled), setupPending: Boolean(user.mfaPendingSecret) });
  } catch (error) {
    return next(error);
  }
}

async function setupMfa(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select("+mfaPendingSecret");
    if (user.mfaEnabled) return res.status(409).json({ message: "Multi-factor authentication is already enabled." });
    const secret = speakeasy.generateSecret({ length: 20, name: `FileGuard (${user.email})` });
    user.mfaPendingSecret = encryptSecret(secret.base32);
    await user.save();
    await recordActivity(req, { event: "auth.mfa.setup.started", severity: "warning" });
    return res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url });
  } catch (error) {
    return next(error);
  }
}

async function enableMfa(req, res, next) {
  const { code } = req.body || {};
  if (typeof code !== "string") return res.status(400).json({ message: "Enter your authenticator code." });
  try {
    const user = await User.findById(req.user.id).select("+mfaPendingSecret");
    if (!user.mfaPendingSecret) return res.status(400).json({ message: "Start multi-factor setup first." });
    const secret = decryptSecret(user.mfaPendingSecret);
    if (!speakeasy.totp.verify({ secret, encoding: "base32", token: code.replace(/\s/g, ""), window: 1 })) {
      return res.status(400).json({ message: "That authenticator code is incorrect." });
    }
    user.mfaSecret = user.mfaPendingSecret;
    user.mfaPendingSecret = undefined;
    user.mfaEnabled = true;
    const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
    user.mfaRecoveryCodeHashes = recoveryCodes.map((recoveryCode) => (
      crypto.createHash("sha256").update(recoveryCode).digest("hex")
    ));
    await user.save();
    await recordActivity(req, { event: "auth.mfa.enabled", severity: "warning" });
    return res.json({ enabled: true, recoveryCodes });
  } catch (error) {
    return next(error);
  }
}

function createMfaChallenge(user) {
  return jwt.sign(
    { purpose: "mfa", ver: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "5m" }
  );
}

module.exports = {
  requestPasswordReset,
  resetAdminAccess,
  resetPassword,
  verifyMfa,
  getMfaStatus,
  setupMfa,
  enableMfa,
  createMfaChallenge,
};

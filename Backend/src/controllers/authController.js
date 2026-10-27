const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const emailPattern = /^\S+@\S+\.\S+$/;

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created: user.createdAt.toISOString(),
  };
}

function validateCredentials({ name, email, password }, includeName) {
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
  if (includeName && (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))) {
    return "Password needs 8+ characters with a letter and a number.";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be 72 characters or fewer.";
  }
  return null;
}

function createToken(user) {
  return jwt.sign(
    { ver: user.tokenVersion },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: "1d" }
  );
}

async function register(req, res, next) {
  const { name, email, password } = req.body || {};
  const validationError = validateCredentials({ name, email, password }, true);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
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
    const token = createToken(user);
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
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash +tokenVersion");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: "Email or password is incorrect." });
    }

    return res.json({ user: publicUser(user), token: createToken(user) });
  } catch (error) {
    return next(error);
  }
}

async function createAdmin(req, res, next) {
  const { name, email, password } = req.body || {};
  const validationError = validateCredentials({ name, email, password }, true);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
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
    return res.json({ message: "Signed out successfully." });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, createAdmin, getCurrentUser, logout };

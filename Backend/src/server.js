require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const app = require("./app");
const User = require("./models/User");

function validateEnvironment() {
  const required = ["MONGODB_URI", "JWT_SECRET", "SUPER_ADMIN_NAME", "SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long.");
  }
  if (process.env.SUPER_ADMIN_PASSWORD.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters long.");
  }
  if (Buffer.byteLength(process.env.SUPER_ADMIN_PASSWORD, "utf8") > 72 ||
      !/[a-z]/i.test(process.env.SUPER_ADMIN_PASSWORD) ||
      !/\d/.test(process.env.SUPER_ADMIN_PASSWORD)) {
    throw new Error("SUPER_ADMIN_PASSWORD must be 72 characters or fewer and contain a letter and a number.");
  }
  if (!/^\S+@\S+\.\S+$/.test(process.env.SUPER_ADMIN_EMAIL.trim())) {
    throw new Error("SUPER_ADMIN_EMAIL must be a valid email address.");
  }
}

async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email }).select("+passwordHash");
  if (existing) {
    if (existing.role !== "superadmin") {
      throw new Error("SUPER_ADMIN_EMAIL is already assigned to a non-super-admin account.");
    }
    return;
  }

  await User.create({
    name: process.env.SUPER_ADMIN_NAME.trim(),
    email,
    passwordHash: await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 12),
    role: "superadmin",
  });
  console.log(`Bootstrapped super admin account: ${email}`);
}

async function start() {
  validateEnvironment();
  await mongoose.connect(process.env.MONGODB_URI);
  await ensureSuperAdmin();

  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => console.log(`FileGuard API listening on port ${port}`));
}

start().catch(async (error) => {
  console.error("Could not start FileGuard API:", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});

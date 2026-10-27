const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^\S+@\S+\.\S+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "admin", "superadmin"],
      default: "user",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "deactivated", "suspended"],
      default: "active",
      required: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, select: false },
    mfaPendingSecret: { type: String, select: false },
    mfaRecoveryCodeHashes: { type: [String], default: [], select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);

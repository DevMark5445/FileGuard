const mongoose = require("mongoose");

const systemSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    permittedFileTypes: { type: [String], default: ["*"] },
    maximumFileSize: { type: Number, default: 50 * 1024 * 1024, min: 1 },
    sessionTimeoutMinutes: { type: Number, default: 24 * 60, min: 5, max: 30 * 24 * 60 },
    securityNotifications: { type: Boolean, default: true },
    minimumPasswordLength: { type: Number, default: 8, min: 8, max: 128 },
    passwordRequiresLetterAndNumber: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SystemSetting", systemSettingSchema);

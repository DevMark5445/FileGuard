const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    severity: { type: String, enum: ["info", "warning", "high"], default: "info", index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorEmail: { type: String, default: "" },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    targetFileId: { type: mongoose.Schema.Types.ObjectId, ref: "FileRecord", default: null, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, maxlength: 100, default: "" },
    userAgent: { type: String, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);

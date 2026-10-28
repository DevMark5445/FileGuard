const mongoose = require("mongoose");

const securityAlertSchema = new mongoose.Schema(
  {
    sourceActivity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ActivityLog",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "investigating", "resolved"],
      default: "open",
      index: true,
    },
    severity: {
      type: String,
      enum: ["warning", "high"],
      default: "warning",
      index: true,
    },
    escalatedAt: { type: Date, default: null },
    notes: [{
      author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      text: { type: String, required: true, maxlength: 2000 },
      createdAt: { type: Date, default: Date.now },
    }],
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SecurityAlert", securityAlertSchema);

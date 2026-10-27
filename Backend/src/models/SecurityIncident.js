const mongoose = require("mongoose");

const securityIncidentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    status: { type: String, enum: ["open", "investigating", "resolved"], default: "open" },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    affectedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    affectedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "FileRecord" }],
    notes: [{
      author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      text: { type: String, required: true, maxlength: 2000 },
      createdAt: { type: Date, default: Date.now },
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SecurityIncident", securityIncidentSchema);

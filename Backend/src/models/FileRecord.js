const mongoose = require("mongoose");

const fileRecordSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    size: { type: Number, required: true, min: 0 },
    hash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    storageKey: { type: String, match: /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i, unique: true, sparse: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    securityStatus: {
      type: String,
      enum: ["not_scanned", "healthy", "corrupted", "modified", "malicious", "inconclusive", "infected", "scan_unavailable"],
      default: "not_scanned",
      index: true,
    },
    structureStatus: { type: String, enum: ["valid", "invalid", "unsupported", "unavailable", "not_checked"], default: "not_checked" },
    structureMessage: { type: String, maxlength: 500, default: "" },
    malwareStatus: { type: String, enum: ["clean", "infected", "unavailable", "not_scanned"], default: "not_scanned" },
    malwareMessage: { type: String, maxlength: 500, default: "" },
    malwareSignature: { type: String, maxlength: 160, default: "" },
    integrityStatus: { type: String, enum: ["matched", "mismatched", "not_registered", "not_checked"], default: "not_checked" },
    latestStatus: {
      type: String,
      enum: ["registered", "intact", "modified"],
      default: "registered",
    },
    verificationCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FileRecord", fileRecordSchema);

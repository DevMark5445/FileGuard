const mongoose = require("mongoose");

const scanResultSchema = new mongoose.Schema(
  {
    file: { type: mongoose.Schema.Types.ObjectId, ref: "FileRecord", default: null, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    fileName: { type: String, required: true, maxlength: 255 },
    fileHash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    securityStatus: {
      type: String,
      enum: ["healthy", "corrupted", "modified", "malicious", "inconclusive"],
      required: true,
      index: true,
    },
    structureStatus: { type: String, enum: ["valid", "invalid", "unsupported", "unavailable"], required: true },
    structureMessage: { type: String, required: true, maxlength: 500 },
    malwareStatus: { type: String, enum: ["clean", "infected", "unavailable"], required: true },
    malwareMessage: { type: String, required: true, maxlength: 500 },
    malwareSignature: { type: String, maxlength: 160, default: "" },
    integrityStatus: { type: String, enum: ["matched", "mismatched", "not_registered"], required: true },
    baselineHash: { type: String, match: /^[a-f\d]{64}$/i, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ScanResult", scanResultSchema);

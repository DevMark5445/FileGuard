const mongoose = require("mongoose");

const fileRecordSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    size: { type: Number, required: true, min: 1 },
    hash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
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

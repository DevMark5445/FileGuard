const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ActivityLog = require("../src/models/ActivityLog");
const FileRecord = require("../src/models/FileRecord");
const SecurityAlert = require("../src/models/SecurityAlert");
const { verifyStoredFile } = require("../src/controllers/adminController");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("stored-file verification compares the retrieved hash and returns the result", async (context) => {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-integrity-"));
  const storageKey = "b3bc13e4-976a-4414-83a8-5d5428b8f2fc";
  const filePath = path.join(storageDirectory, storageKey);
  const originalContent = "registered content";
  const storedHash = crypto.createHash("sha256").update(originalContent).digest("hex");
  await fs.writeFile(filePath, originalContent);

  const previousStorageDirectory = process.env.FILE_STORAGE_DIR;
  const originalFindById = FileRecord.findById;
  const originalActivityCreate = ActivityLog.create;
  const originalAlertCreate = SecurityAlert.create;
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  const previousSmtpValues = Object.fromEntries(smtpKeys.map((key) => [key, process.env[key]]));
  const activityEntries = [];
  const file = {
    id: "507f1f77bcf86cd799439011",
    name: "notes.txt",
    hash: storedHash,
    storageKey,
    owner: { id: "507f1f77bcf86cd799439012", name: "Owner", email: "owner@example.test" },
    latestStatus: "registered",
    verificationCount: 0,
    async save() {},
  };

  process.env.FILE_STORAGE_DIR = storageDirectory;
  smtpKeys.forEach((key) => delete process.env[key]);
  FileRecord.findById = () => ({ populate: async () => file });
  ActivityLog.create = async (entry) => {
    activityEntries.push(entry);
    return { ...entry, id: `activity-${activityEntries.length}`, createdAt: new Date() };
  };
  SecurityAlert.create = async () => ({});

  context.after(async () => {
    FileRecord.findById = originalFindById;
    ActivityLog.create = originalActivityCreate;
    SecurityAlert.create = originalAlertCreate;
    if (previousStorageDirectory === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorageDirectory;
    smtpKeys.forEach((key) => {
      if (previousSmtpValues[key] === undefined) delete process.env[key];
      else process.env[key] = previousSmtpValues[key];
    });
    await fs.rm(storageDirectory, { recursive: true, force: true });
  });

  const req = {
    params: { id: file.id },
    user: { id: "507f1f77bcf86cd799439013", role: "admin" },
    ip: "127.0.0.1",
    get: () => "test",
  };
  const next = (error) => { throw error; };

  const intactResponse = createResponse();
  await verifyStoredFile(req, intactResponse, next);
  assert.equal(intactResponse.statusCode, 200);
  assert.equal(intactResponse.body.log.result, "intact");
  assert.equal(intactResponse.body.log.storedHash, storedHash);
  assert.equal(intactResponse.body.log.newHash, storedHash);
  assert.equal(file.verificationCount, 1);

  const changedContent = "changed content";
  const changedHash = crypto.createHash("sha256").update(changedContent).digest("hex");
  await fs.writeFile(filePath, changedContent);

  const modifiedResponse = createResponse();
  await verifyStoredFile(req, modifiedResponse, next);
  assert.equal(modifiedResponse.body.log.result, "modified");
  assert.equal(modifiedResponse.body.log.storedHash, storedHash);
  assert.equal(modifiedResponse.body.log.newHash, changedHash);
  assert.equal(file.latestStatus, "modified");
  assert.equal(file.securityStatus, "modified");
  assert.equal(file.verificationCount, 2);
  assert.deepEqual(activityEntries.map((entry) => entry.event), ["file.verified", "file.modified"]);

  file.storageKey = "fe7eec2b-e491-4d84-8dc0-098935ca807f";
  const unavailableResponse = createResponse();
  await verifyStoredFile(req, unavailableResponse, next);
  assert.equal(unavailableResponse.statusCode, 409);
  assert.equal(unavailableResponse.body.message, "The saved original file is unavailable, so its integrity cannot be checked.");
  assert.equal(file.verificationCount, 2);
});

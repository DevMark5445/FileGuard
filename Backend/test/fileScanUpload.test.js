const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ActivityLog = require("../src/models/ActivityLog");
const FileRecord = require("../src/models/FileRecord");
const ScanResult = require("../src/models/ScanResult");
const SecurityAlert = require("../src/models/SecurityAlert");
const { uploadFile, verifyFile } = require("../src/controllers/fileController");

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

test("uploads retain scan findings, report unavailable scans as inconclusive, and preserve the original baseline", async (context) => {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-upload-scan-"));
  const previousStorageDirectory = process.env.FILE_STORAGE_DIR;
  const previousScanner = process.env.CLAMSCAN_PATH;
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  const previousSmtpValues = Object.fromEntries(smtpKeys.map((key) => [key, process.env[key]]));
  const originals = {
    findOne: FileRecord.findOne,
    create: FileRecord.create,
    deleteOne: FileRecord.deleteOne,
    scanCreate: ScanResult.create,
    activityCreate: ActivityLog.create,
    alertCreate: SecurityAlert.create,
  };
  const createdFiles = [];
  const scanEntries = [];
  const activityEntries = [];
  let securityAlertsCreated = 0;
  const baseline = { hash: "a".repeat(64) };

  process.env.FILE_STORAGE_DIR = storageDirectory;
  process.env.CLAMSCAN_PATH = "fileguard-clamav-command-that-does-not-exist";
  smtpKeys.forEach((key) => delete process.env[key]);
  FileRecord.findOne = (query) => {
    if (query.name) return { sort: async () => query.name === "invoice.pdf" ? baseline : null };
    return Promise.resolve(createdFiles.find((file) => file.id === query._id) || null);
  };
  FileRecord.create = async (attributes) => {
    const file = {
      ...attributes,
      id: `file-${createdFiles.length + 1}`,
      createdAt: new Date(),
      verificationCount: 0,
      save: async () => {},
    };
    createdFiles.push(file);
    return file;
  };
  FileRecord.deleteOne = async () => ({ deletedCount: 1 });
  ScanResult.create = async (attributes) => {
    scanEntries.push(attributes);
    return { ...attributes, id: `scan-${scanEntries.length}` };
  };
  ActivityLog.create = async (attributes) => {
    activityEntries.push(attributes);
    return { ...attributes, id: `activity-${activityEntries.length}`, createdAt: new Date() };
  };
  SecurityAlert.create = async () => {
    securityAlertsCreated += 1;
    return {};
  };

  context.after(async () => {
    FileRecord.findOne = originals.findOne;
    FileRecord.create = originals.create;
    FileRecord.deleteOne = originals.deleteOne;
    ScanResult.create = originals.scanCreate;
    ActivityLog.create = originals.activityCreate;
    SecurityAlert.create = originals.alertCreate;
    if (previousStorageDirectory === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorageDirectory;
    if (previousScanner === undefined) delete process.env.CLAMSCAN_PATH;
    else process.env.CLAMSCAN_PATH = previousScanner;
    smtpKeys.forEach((key) => {
      if (previousSmtpValues[key] === undefined) delete process.env[key];
      else process.env[key] = previousSmtpValues[key];
    });
    await fs.rm(storageDirectory, { recursive: true, force: true });
  });

  const upload = async (fileName, content, storageKey) => {
    await fs.writeFile(path.join(storageDirectory, storageKey), content);
    const req = {
      file: { filename: storageKey, size: Buffer.byteLength(content) },
      uploadOriginalName: fileName,
      user: { id: "507f1f77bcf86cd799439011", email: "user@example.test" },
      ip: "127.0.0.1",
      get: () => "test",
    };
    const response = createResponse();
    await uploadFile(req, response, (error) => { throw error; });
    return response;
  };

  const brokenPdf = "%PDF-1.7\n%%EOF";
  const first = await upload("invoice.pdf", brokenPdf, "b3bc13e4-976a-4414-83a8-5d5428b8f2fc");
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.file.securityStatus, "corrupted");
  assert.equal(first.body.file.integrityStatus, "mismatched");
  assert.equal(first.body.scan.structureStatus, "invalid");
  assert.equal(scanEntries[0].baselineHash, baseline.hash);
  assert.equal(createdFiles[0].hash, baseline.hash);
  assert.equal(scanEntries[0].fileHash, crypto.createHash("sha256").update(brokenPdf).digest("hex"));
  assert.equal(await fs.readFile(path.join(storageDirectory, "b3bc13e4-976a-4414-83a8-5d5428b8f2fc"), "utf8"), brokenPdf);
  assert.equal(baseline.hash, "a".repeat(64));
  assert.equal(activityEntries[0].event, "file.modified");

  const secondPdf = "%PDF-1.7\nsecond upload";
  const second = await upload("invoice.pdf", secondPdf, "bcbbd920-0791-4f47-80ee-0b9a2c90e92e");
  assert.equal(second.body.file.securityStatus, "corrupted");
  assert.equal(createdFiles[1].hash, baseline.hash);
  assert.equal(scanEntries[1].baselineHash, baseline.hash);
  assert.equal(scanEntries[1].fileHash, crypto.createHash("sha256").update(secondPdf).digest("hex"));

  const third = await upload("notes.txt", "valid UTF-8 text", "fe7eec2b-e491-4d84-8dc0-098935ca807f");
  assert.equal(third.body.file.securityStatus, "inconclusive");
  assert.equal(third.body.file.malwareStatus, "unavailable");
  assert.equal(scanEntries[2].malwareStatus, "unavailable");
  assert.equal(activityEntries[2].event, "file.scan.completed");
  assert.equal(securityAlertsCreated, 2, "only hash mismatches have raised alerts so far");
  assert.equal(await fs.readFile(path.join(storageDirectory, "fe7eec2b-e491-4d84-8dc0-098935ca807f"), "utf8"), "valid UTF-8 text");

  const verificationKey = "a61ce19e-3852-4e31-b3da-4a2ae3aac393";
  await fs.writeFile(path.join(storageDirectory, verificationKey), secondPdf);
  const verificationRequest = {
    params: { id: createdFiles[1].id },
    file: { filename: verificationKey, size: Buffer.byteLength(secondPdf) },
    uploadOriginalName: "invoice.pdf",
    user: { id: "507f1f77bcf86cd799439011", email: "user@example.test" },
    ip: "127.0.0.1",
    get: () => "test",
  };
  const verificationResponse = createResponse();
  await verifyFile(verificationRequest, verificationResponse, (error) => { throw error; });
  assert.equal(verificationResponse.body.log.result, "modified");
  assert.equal(verificationResponse.body.log.storedHash, baseline.hash);
  assert.equal(verificationResponse.body.log.newHash, crypto.createHash("sha256").update(secondPdf).digest("hex"));
  assert.equal(verificationResponse.body.log.integrityStatus, "mismatched");
  assert.equal(scanEntries[3].baselineHash, baseline.hash);
  assert.equal(await fs.readFile(path.join(storageDirectory, verificationKey), "utf8"), secondPdf);
});

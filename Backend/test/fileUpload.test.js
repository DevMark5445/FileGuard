const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const SystemSetting = require("../src/models/SystemSetting");
const { uploadFile } = require("../src/middleware/fileUpload");

test("upload middleware validates policy and stores files under generated names", async (context) => {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-upload-"));
  const previousStorageDirectory = process.env.FILE_STORAGE_DIR;
  const originalFindOne = SystemSetting.findOne;
  process.env.FILE_STORAGE_DIR = storageDirectory;
  SystemSetting.findOne = async () => ({ maximumFileSize: 4, permittedFileTypes: [".txt"] });

  const app = express();
  app.post("/upload", uploadFile, (req, res) => {
    res.status(201).json({
      name: req.uploadOriginalName,
      storageKey: req.file.filename,
      size: req.file.size,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  context.after(async () => {
    SystemSetting.findOne = originalFindOne;
    if (previousStorageDirectory === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorageDirectory;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await fs.rm(storageDirectory, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/upload`;

  const validUpload = new FormData();
  validUpload.append("file", new Blob(["data"]), "C:\\fakepath\\notes.txt");
  const validResponse = await fetch(url, { method: "POST", body: validUpload });
  assert.equal(validResponse.status, 201);
  const uploaded = await validResponse.json();
  assert.equal(uploaded.name, "notes.txt");
  assert.equal(uploaded.size, 4);
  assert.match(uploaded.storageKey, /^[a-f\d-]{36}$/i);
  assert.equal(await fs.readFile(path.join(storageDirectory, uploaded.storageKey), "utf8"), "data");

  const disallowedUpload = new FormData();
  disallowedUpload.append("file", new Blob(["data"]), "payload.exe");
  const disallowedResponse = await fetch(url, { method: "POST", body: disallowedUpload });
  assert.equal(disallowedResponse.status, 400);

  const oversizedUpload = new FormData();
  oversizedUpload.append("file", new Blob(["12345"]), "large.txt");
  const oversizedResponse = await fetch(url, { method: "POST", body: oversizedUpload });
  assert.equal(oversizedResponse.status, 400);
});

const fs = require("node:fs/promises");
const path = require("node:path");

const STORAGE_KEY_PATTERN = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

function getStorageDirectory() {
  return path.resolve(
    process.env.FILE_STORAGE_DIR || path.join(__dirname, "..", "..", "storage")
  );
}

function getStoredFilePath(storageKey) {
  if (typeof storageKey !== "string" || !STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("Invalid stored-file identifier.");
  }
  return path.join(getStorageDirectory(), storageKey);
}

async function ensureStorageDirectory() {
  const directory = getStorageDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function removeStoredFile(storageKey) {
  try {
    await fs.unlink(getStoredFilePath(storageKey));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = { ensureStorageDirectory, getStoredFilePath, removeStoredFile };

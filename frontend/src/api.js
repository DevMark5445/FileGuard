const FILES_KEY = "fileguard.files";
const HISTORY_KEY = "fileguard.history";

function readList(key) {
  const value = window.localStorage.getItem(key);
  if (value === null) return [];

  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved FileGuard data is invalid. Clear this site's storage and try again.");
  }
  return parsed;
}

function writeList(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function hashFile(file) {
  if (!window.crypto?.subtle) {
    throw new Error("File hashing requires a secure browser context (HTTPS or localhost).");
  }

  const bytes = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const api = {
  async getFiles() {
    return readList(FILES_KEY);
  },

  async getHistory() {
    return readList(HISTORY_KEY).sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async addFile(file) {
    const files = readList(FILES_KEY);
    const hash = await hashFile(file);
    const record = {
      id: window.crypto.randomUUID(),
      name: file.name,
      size: file.size,
      hash,
      date: new Date().toISOString(),
    };
    writeList(FILES_KEY, [...files, record]);
    return record;
  },

  async deleteFile(id) {
    writeList(FILES_KEY, readList(FILES_KEY).filter((file) => file.id !== id));
  },

  async verify(id, file) {
    const registered = readList(FILES_KEY).find((entry) => entry.id === id);
    if (!registered) throw new Error("That registered file could not be found.");

    const newHash = await hashFile(file);
    const result = newHash === registered.hash ? "intact" : "modified";
    const log = {
      id: window.crypto.randomUUID(),
      fileName: registered.name,
      date: new Date().toISOString(),
      result,
      reviewed: false,
      storedHash: registered.hash,
      newHash,
    };
    writeList(HISTORY_KEY, [log, ...readList(HISTORY_KEY)]);
    return log;
  },

  async reviewLog(id) {
    const logs = readList(HISTORY_KEY);
    const log = logs.find((entry) => entry.id === id);
    if (!log) throw new Error("That verification record could not be found.");
    writeList(HISTORY_KEY, logs.map((entry) => (
      entry.id === id ? { ...entry, reviewed: true } : entry
    )));
  },
};

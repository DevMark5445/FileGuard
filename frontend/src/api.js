const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const FILES_KEY = "fileguard.files";
const HISTORY_KEY = "fileguard.history";

async function request(path, options = {}) {
  const token = window.localStorage.getItem("fg_token");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.message || "The FileGuard request failed.");
  }
  return body;
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

function assertAuthenticated() {
  if (!window.localStorage.getItem("fg_token")) {
    throw new Error("Sign in to use FileGuard.");
  }
}

function readLegacyList(key) {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return [];
  const list = JSON.parse(saved);
  if (!Array.isArray(list)) {
    throw new Error("Saved FileGuard data is invalid. Clear this site's storage and try again.");
  }
  return list;
}

export const api = {
  async getFilePolicy() {
    assertAuthenticated();
    return request("/files/policy");
  },

  async getFiles() {
    assertAuthenticated();
    let { files } = await request("/files");
    const legacyFiles = readLegacyList(FILES_KEY);
    if (legacyFiles.length) {
      for (let index = 0; index < legacyFiles.length; index += 100) {
        await request("/files/import", {
          method: "POST",
          body: JSON.stringify({ files: legacyFiles.slice(index, index + 100) }),
        });
      }
      window.localStorage.removeItem(FILES_KEY);
      ({ files } = await request("/files"));
    }
    return files;
  },

  async getHistory() {
    assertAuthenticated();
    const { logs } = await request("/files/history");
    const legacyLogs = readLegacyList(HISTORY_KEY);
    return [...logs, ...legacyLogs.filter((legacy) => !logs.some((log) => log.id === legacy.id))]
      .sort((left, right) => new Date(right.date) - new Date(left.date));
  },

  async addFile(file) {
    assertAuthenticated();
    const hash = await hashFile(file);
    const { file: record } = await request("/files", {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size, hash }),
    });
    return record;
  },

  async deleteFile(id) {
    assertAuthenticated();
    await request(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async verify(id, file) {
    assertAuthenticated();
    const hash = await hashFile(file);
    const { log } = await request(`/files/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      body: JSON.stringify({ hash }),
    });
    return log;
  },

  async reviewLog(id) {
    assertAuthenticated();
    const legacyLogs = readLegacyList(HISTORY_KEY);
    if (legacyLogs.some((log) => log.id === id)) {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(legacyLogs.map((log) => (
        log.id === id ? { ...log, reviewed: true } : log
      ))));
      return;
    }
    await request(`/files/history/${encodeURIComponent(id)}/review`, { method: "PATCH" });
  },
};

export const adminApi = {
  async get(path) {
    return request(`/admin${path}`);
  },

  async mutate(path, method, data) {
    return request(`/admin${path}`, {
      method,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  },

  async createAdmin(data) {
    return request("/auth/admins", { method: "POST", body: JSON.stringify(data) });
  },

  async downloadReport(filters = {}) {
    const token = window.localStorage.getItem("fg_token");
    const query = new URLSearchParams(filters).toString();
    const response = await fetch(`${API_BASE_URL}/admin/reports.csv${query ? `?${query}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Could not download report.");
    }
    return response.blob();
  },
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const token = window.localStorage.getItem("fg_token");
  const isMultipart = options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isMultipart ? {} : { "Content-Type": "application/json" }),
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

async function requestBlob(path) {
  const token = window.localStorage.getItem("fg_token");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.message || "The FileGuard request failed.");
  }
  return response.blob();
}

function assertAuthenticated() {
  if (!window.localStorage.getItem("fg_token")) {
    throw new Error("Sign in to use FileGuard.");
  }
}

export const api = {
  async getFilePolicy() {
    assertAuthenticated();
    return request("/files/policy");
  },

  async getFiles() {
    assertAuthenticated();
    const { files } = await request("/files");
    return files;
  },

  async getHistory() {
    assertAuthenticated();
    const { logs } = await request("/files/history");
    return logs;
  },

  async addFile(file) {
    assertAuthenticated();
    const body = new FormData();
    body.append("file", file, file.name);
    const { file: record, scan } = await request("/files/upload", {
      method: "POST",
      body,
    });
    return { ...record, scan };
  },

  async deleteFile(id) {
    assertAuthenticated();
    await request(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async verify(id, file) {
    assertAuthenticated();
    const body = new FormData();
    body.append("file", file, file.name);
    const { log } = await request(`/files/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      body,
    });
    return log;
  },

  async getVerificationDiff(id) {
    assertAuthenticated();
    return request(`/files/history/${encodeURIComponent(id)}/diff`);
  },

  async getChangedCopy(id) {
    assertAuthenticated();
    return requestBlob(`/files/history/${encodeURIComponent(id)}/changed-copy`);
  },

  async downloadFile(id) {
    assertAuthenticated();
    return requestBlob(`/files/${encodeURIComponent(id)}/download`);
  },

  async downloadStoredFile(id, name) {
    const blob = await this.downloadFile(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name || "file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async downloadChangedCopy(id, name) {
    const blob = await this.getChangedCopy(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name || "changed-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async reviewLog(id) {
    assertAuthenticated();
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

  async archiveActivity(before) {
    return request("/admin/activity/archive", {
      method: "POST",
      body: JSON.stringify({ before }),
    });
  },

  async restoreActivity(id) {
    return request(`/admin/activity/${encodeURIComponent(id)}/restore`, { method: "POST" });
  },

  async createAdmin(data) {
    return request("/auth/admins", { method: "POST", body: JSON.stringify(data) });
  },

  async verifyFile(fileId, file, reason) {
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("reason", reason);
    return request(`/files/${encodeURIComponent(fileId)}/admin-verify`, {
      method: "POST",
      body,
    });
  },

  async verifyStoredFile(fileId) {
    assertAuthenticated();
    return request(`/admin/files/${encodeURIComponent(fileId)}/verify-stored`, {
      method: "POST",
    });
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

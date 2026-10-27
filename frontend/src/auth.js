const TOKEN_KEY = "fg_token";
const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw Object.assign(new Error(body.message || "The authentication request failed."), {
      status: response.status,
    });
  }
  return body;
}

export async function initializeAuth() {
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  try {
    const { user } = await request("/auth/me", { token });
    return user;
  } catch (error) {
    if (error instanceof Error && error.status === 401) {
      window.localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    throw error;
  }
}

export async function authenticate({ mode, name, email, password }) {
  if (mode !== "register" && mode !== "login") {
    throw new Error("Unsupported authentication mode.");
  }

  const { user, token } = await request(`/auth/${mode === "register" ? "register" : "login"}`, {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  window.localStorage.setItem(TOKEN_KEY, token);
  return user;
}

export async function signOut() {
  const token = window.localStorage.getItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  if (token) {
    await request("/auth/logout", { method: "POST", token });
  }
}

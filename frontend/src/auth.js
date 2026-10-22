const USERS_KEY = "fg_users";
const SESSION_KEY = "fg_me";

function readUsers() {
  const saved = window.localStorage.getItem(USERS_KEY);
  if (saved === null) return [];

  const users = JSON.parse(saved);
  if (!Array.isArray(users)) {
    throw new Error("Saved account data is invalid. Clear this site's storage and try again.");
  }
  return users;
}

function hashText(value) {
  if (!window.crypto?.subtle) {
    throw new Error("Sign-in requires a secure browser context (HTTPS or localhost).");
  }

  return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""));
}

export async function initializeAuth() {
  const users = readUsers();
  if (!users.some((user) => user.role === "admin")) {
    const admin = {
      id: window.crypto.randomUUID(),
      name: "Administrator",
      email: "admin@fileguard.local",
      passwordHash: await hashText("Admin@123"),
      role: "admin",
      created: new Date().toISOString(),
    };
    window.localStorage.setItem(USERS_KEY, JSON.stringify([...users, admin]));
  }

  const savedSession = window.localStorage.getItem(SESSION_KEY);
  return savedSession ? JSON.parse(savedSession) : null;
}

export async function authenticate({ mode, name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const users = readUsers();
  const passwordHash = await hashText(password);

  if (mode === "register") {
    if (!name.trim()) throw new Error("Enter your full name.");
    if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      throw new Error("Password needs 8+ characters with a letter and a number.");
    }
    if (users.some((user) => user.email === normalizedEmail)) {
      throw new Error("An account with this email already exists. Sign in instead.");
    }

    const user = {
      id: window.crypto.randomUUID(),
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "user",
      created: new Date().toISOString(),
    };
    window.localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]));
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }

  const user = users.find((entry) => entry.email === normalizedEmail);
  if (!user || user.passwordHash !== passwordHash) {
    throw new Error("Email or password is incorrect.");
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

export function signOut() {
  window.localStorage.removeItem(SESSION_KEY);
}

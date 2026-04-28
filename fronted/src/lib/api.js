export const API_BASE = "http://localhost:3000/api";

export function getToken() {
  return localStorage.getItem("token") || "";
}

export function setAuth(token, userId) {
  localStorage.setItem("token", token || "");
  localStorage.setItem("userId", String(userId || ""));
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_error) {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.message || `HTTP ${res.status}`);
  }

  return data;
}

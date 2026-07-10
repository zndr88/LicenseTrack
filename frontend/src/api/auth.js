/**
 * Authentication API — login, logout, current user, password change.
 *
 * Endpoints:
 *   POST /api/auth/login            — obtain JWT
 *   POST /api/auth/change-password  — change own password (authenticated)
 *   GET  /api/users/me              — current user profile
 */

import { apiUrl, clearToken, get, post, setToken } from "./client.js";

/**
 * Detect the public authentication mode.
 * Uses plain fetch (no auth header) — safe to call before any token exists.
 * Defaults to local login on any error so normal auth is unaffected.
 */
export async function getAuthMode() {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    return { oidc_enabled: false, oidc_available: false };
  }
  try {
    const res = await fetch(apiUrl("/api/auth/mode"), { credentials: "include" });
    if (!res.ok) return { oidc_enabled: false, oidc_available: false };
    return res.json();
  } catch {
    return { oidc_enabled: false, oidc_available: false };
  }
}

/**
 * Log in with username and password.
 * On success, stores the JWT in memory and returns the user object.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ data: { access_token: string, token_type: string, user: object } | null, error: string | null }>}
 */
export async function login(username, password) {
  const { data, error } = await post("/api/auth/login", { username, password });
  if (data?.access_token) {
    setToken(data.access_token);
  }
  return { data, error };
}

/**
 * Log out the current user by clearing the in-memory token.
 * There is no server-side session to invalidate with stateless JWTs.
 */
export function logout() {
  clearToken();
}

export async function logoutSession() {
  const { error } = await post("/api/auth/logout");
  clearToken();
  return { error };
}

/**
 * Fetch the authenticated user's own profile.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getCurrentUser() {
  return get("/api/users/me", { redirectOn401: false });
}

/**
 * Check whether a cookie-backed session exists without producing a 401 for
 * anonymous users on the login page.
 *
 * @returns {Promise<{ data: { authenticated: boolean, user: object | null } | null, error: string | null }>}
 */
export async function getSession() {
  return get("/api/auth/session", { redirectOn401: false });
}

/**
 * Change the authenticated user's password.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function changePassword(currentPassword, newPassword) {
  return post("/api/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/**
 * Authentication API - public auth mode, login/session, logout, and password
 * change.
 *
 * Endpoints:
 *   GET  /api/auth/mode - public auth mode
 *   GET  /api/auth/session - cookie-backed session state
 *   POST /api/auth/login - obtain JWT and set session cookie
 *   POST /api/auth/refresh - rotate an active session token
 *   POST /api/auth/logout - clear session cookie
 *   POST /api/auth/change-password - change own password (authenticated)
 */

import { apiUrl, coordinateRefresh, getSessionGeneration, startSessionTransition, getToken, isSessionLocked, lockSession, unlockSession, get, post, setSessionCoordinationId, sessionCoordinationKey, setToken } from "./client.js";

/**
 * Detect the public authentication mode.
 * Uses plain fetch (no auth header) - safe to call before any token exists.
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
  const generation = startSessionTransition();
  const { data, error } = await post("/api/auth/login", { username, password });
  if (generation !== getSessionGeneration()) {
    if (data?.access_token) await post("/api/auth/logout", undefined, {
      redirectOn401: false, headers: { Authorization: `Bearer ${data.access_token}` },
      signal: window.AbortSignal.timeout(10_000),
    });
    return { data: null, error: "Session ended. Please sign in again." };
  }
  if (data) unlockSession();
  if (data?.access_token) {
    setToken(data.access_token);
  }
  return { data, error };
}

export async function logoutSession() {
  const token = getToken();
  lockSession();
  window.localStorage.setItem(sessionCoordinationKey("logout"), String(Date.now()));
  const { error } = await post("/api/auth/logout", undefined, {
    redirectOn401: false, signal: window.AbortSignal.timeout(10_000),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { error };
}

/**
 * Check whether a cookie-backed session exists without producing a 401 for
 * anonymous users on the login page.
 *
 * @returns {Promise<{ data: { authenticated: boolean, user: object | null } | null, error: string | null }>}
 */
export async function getSession() {
  if (isSessionLocked()) return { data: { authenticated: false }, error: null };
  const generation = getSessionGeneration();
  const result = await get("/api/auth/session", { redirectOn401: false });
  if (generation !== getSessionGeneration() || isSessionLocked()) return { data: { authenticated: false }, error: null };
  if (result.data?.expires_at) {
    setSessionCoordinationId(result.data.coordination_id);
    window.localStorage.setItem(sessionCoordinationKey("expiry"), String(result.data.expires_at * 1000));
  }
  return result;
}

/** Rotate the current token so active users retain a sliding session. */
export function refreshSession() {
  return coordinateRefresh(async () => {
    const generation = getSessionGeneration();
    if (isSessionLocked()) return { data: null, error: "Session ended." };
    const result = await post("/api/auth/refresh", undefined, {
      redirectOn401: false, signal: window.AbortSignal.timeout(10_000),
    });
    if (generation === getSessionGeneration() && result.data?.access_token) {
      setToken(result.data.access_token);
    }
    return result;
  });
}

/**
 * Change the authenticated user's password.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<{ data: { access_token: string, token_type: string } | null, error: string | null }>}
 */
export async function changePassword(currentPassword, newPassword) {
  const generation = getSessionGeneration();
  const result = await post("/api/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  if (generation === getSessionGeneration() && result.data?.access_token) setToken(result.data.access_token);
  return result;
}

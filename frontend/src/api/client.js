/**
 * Core fetch wrapper for the API.
 *
 * - Prepends VITE_API_URL when set; callers pass full same-origin /api paths
 *   by default, such as /api/licenses.
 * - Uses the shared HttpOnly session cookie for browser authentication
 * - Parses JSON responses automatically
 * - On 401, locks the session and redirects to the login page
 * - Returns { data, error } for consistent error handling throughout the app
 */

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

// Only non-secret session metadata is shared between browser tabs.

let token = null;
const bearerDeployment = API_BASE_URL && new URL(API_BASE_URL, window.location.href).origin !== window.location.origin;
const tokenChannel = typeof window.BroadcastChannel === "function"
  ? new window.BroadcastChannel("licensetrack.session.credentials") : null;
function tokenSessionId(value) {
  try { return JSON.parse(window.atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id; }
  catch { return null; }
}
if (tokenChannel) tokenChannel.onmessage = ({ data }) => {
  if (!locallyLocked && token && tokenSessionId(token) === tokenSessionId(data?.token)) {
    setToken(data.token, false);
  }
};
/** Match expiry to the credentials this tab will send on its next request. */
export function getSessionExpiry() {
  if (bearerDeployment && token) {
    try {
      const payload = JSON.parse(window.atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const expiry = Number(payload.exp) * 1000;
      return Number.isFinite(expiry) && expiry > 0 ? expiry : 0;
    } catch { return 0; }
  }
  return Number(window.localStorage.getItem("licensetrack.session.expiry")) || 0;
}
export function getToken() { return token; }
let refreshPromise = null;
let refreshCheck = null;
export function setSessionRefreshCheck(check) { refreshCheck = check; }
let sessionGeneration = 0;
let locallyLocked = window.localStorage.getItem("licensetrack.session.locked") === "true";
export function startSessionTransition() {
  sessionGeneration += 1;
  clearToken();
  return sessionGeneration;
}
export function getSessionGeneration() { return sessionGeneration; }
export function isSessionLocked() { return locallyLocked; }
export function unlockSession() {
  locallyLocked = false;
  window.localStorage.removeItem("licensetrack.session.locked");
}
export function lockSession() {
  locallyLocked = true;
  window.localStorage.setItem("licensetrack.session.locked", "true");
  sessionGeneration += 1;
  clearToken();
}
export function coordinateRefresh(work) {
  if (!refreshPromise) refreshPromise = work().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/** Keep a bearer in memory for split deployments; persist only expiry metadata. */
export function setToken(value, broadcast = true) {
  const sameSession = token && tokenSessionId(token) === tokenSessionId(value);
  if (sameSession) {
    try {
      const expiry = candidate => JSON.parse(window.atob(candidate.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp;
      if (expiry(value) < expiry(token)) return;
    } catch { /* Demo tokens have no expiry claims. */ }
  }
  token = value;
  if (broadcast) tokenChannel?.postMessage({ token: value });
  // Same-origin requests use the stable cookie. Bearers never enter localStorage.
  unlockSession();
  try {
    const payload = JSON.parse(window.atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    window.localStorage.setItem("licensetrack.session.expiry", String(payload.exp * 1000));
  } catch { /* Demo tokens do not contain JWT claims. */ }
}

/** Clear local expiry metadata. */
export function clearToken() {
  token = null;
  window.localStorage.removeItem("licensetrack.session.expiry");
}

/**
 * Make an authenticated request to the backend.
 *
 * @param {string} path - API path, e.g. "/api/licenses"
 * @param {RequestInit} [options] - Standard fetch options (method, body, headers, ...)
 * @returns {Promise<{ data: any, error: string | null }>}
 */
export async function request(path, options = {}) {
  const url = apiUrl(path);
  const sessionControl = path.startsWith("/api/auth/") && path !== "/api/auth/change-password";

  // Demo build only: route to the in-browser fake backend instead of the network.
  // Build-time constant - dead-code-eliminated (module and all) in normal builds.
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    try {
      const { demoRequest } = await import("../demo/router.js");
      return demoRequest(path, options);
    } catch {
      return { data: null, error: "Demo backend failed to load — try refreshing the page." };
    }
  }

  const redirectOn401 = options.redirectOn401 ?? true;

  const headers = {
    ...options.headers,
  };

  // Only set Content-Type to JSON when we're not sending FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (!sessionControl) {
    if (!locallyLocked) await refreshCheck?.();
    if (refreshPromise) await refreshPromise;
    if (locallyLocked) return { data: null, error: "Session expired. Please log in again." };
  }

  if (bearerDeployment && token && !headers.Authorization && path !== "/api/auth/login") {
    headers.Authorization = `Bearer ${token}`;
  }
  const generation = sessionGeneration;
  let response;
  try {
    response = await fetch(url, { ...options, headers, credentials: "include" });
  } catch (_networkError) {
    return { data: null, error: "Network error — is the server running?" };
  }

  // 401 -> token expired or missing; clear state and bounce to login
  if (response.status === 401) {
    if (generation !== sessionGeneration) return { data: null, error: "Session ended." };
    if (!sessionControl && refreshPromise && !options.authRetried) {
      await refreshPromise;
      return request(path, { ...options, authRetried: true });
    }
    if (redirectOn401) lockSession();
    if (redirectOn401) {
      window.location.href = "/";
    }
    return { data: null, error: "Session expired. Please log in again." };
  }

  // 204 No Content - successful but empty body
  if (response.status === 204) {
    return { data: null, error: null };
  }

  // JSON responses (API success and error bodies)
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json") || contentType === "") {
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const raw =
        body?.detail ??
        body?.message ??
        `Request failed with status ${response.status}`;
      let message;
      if (typeof raw === "string") {
        message = raw;
      } else if (Array.isArray(raw)) {
        message = raw.map(e => e.msg || e.message || JSON.stringify(e)).join("; ");
      } else {
        message = JSON.stringify(raw);
      }
      return { data: null, error: message };
    }

    return { data: body, error: null };
  }

  // Non-JSON response (file download of any MIME type) - return the raw Response
  if (!response.ok) {
    let text;
    try {
      text = await response.text();
    } catch {
      // Fall back to the generic status message below.
    }
    return { data: null, error: text || `Request failed: ${response.status}` };
  }
  return { data: response, error: null };
}

/** Convenience wrappers */
export const get = (path, options = {}) =>
  request(path, { ...options, method: "GET" });

export const post = (path, body, options = {}) =>
  request(path, {
    ...options,
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body),
  });

export const put = (path, body, options = {}) =>
  request(path, {
    ...options,
    method: "PUT",
    body: JSON.stringify(body),
  });

export const patch = (path, body, options = {}) =>
  request(path, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const del = (path, options = {}) =>
  request(path, { ...options, method: "DELETE" });

/**
 * Core fetch wrapper for the API.
 *
 * - Prepends API base URL when VITE_API_URL is set; defaults to same-origin /api
 * - Attaches Authorization: Bearer <token> header when a token is stored
 * - Parses JSON responses automatically
 * - On 401, clears the stored token and redirects to the login page
 * - Returns { data, error } for consistent error handling throughout the app
 */

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

// In-memory token store — intentionally not localStorage for security.
// Token is lost on page refresh; users must log in again.
let _token = null;

/** Store a JWT access token in memory. */
export function setToken(token) {
  _token = token;
}

/** Clear the stored JWT token. */
export function clearToken() {
  _token = null;
}

/** Return the currently stored token (or null). */
export function getToken() {
  return _token;
}

/**
 * Make an authenticated request to the backend.
 *
 * @param {string} path       - API path, e.g. "/api/licenses"
 * @param {RequestInit} [options] - Standard fetch options (method, body, headers, …)
 * @returns {Promise<{ data: any, error: string | null }>}
 */
export async function request(path, options = {}) {
  const url = apiUrl(path);

  // Demo build only: route to the in-browser fake backend instead of the network.
  // Build-time constant — dead-code-eliminated (module and all) in normal builds.
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const { demoRequest } = await import("../demo/router.js");
    return demoRequest(path, options);
  }

  const redirectOn401 = options.redirectOn401 ?? true;

  const headers = {
    ...options.headers,
  };

  // Only set Content-Type to JSON when we're not sending FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  let response;
  try {
    response = await fetch(url, { ...options, headers, credentials: "include" });
  } catch (_networkError) {
    return { data: null, error: "Network error — is the server running?" };
  }

  // 401 → token expired or missing; clear state and bounce to login
  if (response.status === 401) {
    clearToken();
    if (redirectOn401) {
      window.location.href = "/";
    }
    return { data: null, error: "Session expired. Please log in again." };
  }

  // 204 No Content — successful but empty body
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

  // Non-JSON response (file download of any MIME type) — return the raw Response
  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
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

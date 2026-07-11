// The marker below must live in REACHABLE CODE, not a comment — the minifier
// strips comments in all build modes. This console.info is a module-load side
// effect: not tree-shakeable, useful to auditors, and it anchors CI's
// production-bundle purity grep.
console.info("LicenseTrack demo mode active — LICENSETRACK_DEMO_MARKER");
import { routes, stubResponse } from "./handlers.js";

/**
 * Demo-mode replacement for the fetch call in api/client.js request().
 * Same contract: resolves to { data, error }.
 *
 * Route table entries: { method, pattern (RegExp with named groups), handler }.
 * Handlers receive ({ params, body, query, formData }) and return { data, error } or throw.
 */
export async function demoRequest(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const [pathname, search] = path.split("?");
  const query = new URLSearchParams(search ?? "");

  let body = null;
  let formData = null;
  if (options.body instanceof FormData) {
    formData = options.body;
    // Mirror backend multipart endpoints: JSON payload travels in the "data" field.
    const raw = options.body.get("data");
    body = raw ? JSON.parse(raw) : null;
  } else if (typeof options.body === "string") {
    body = JSON.parse(options.body);
  }

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;
    try {
      return await route.handler({ params: match.groups ?? {}, body, query, formData });
    } catch (err) {
      return { data: null, error: err.message ?? "Demo error" };
    }
  }
  return stubResponse(method, pathname);
}

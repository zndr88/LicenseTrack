// This module must never appear in a production bundle. CI greps a normal
// build's dist/ for the LICENSETRACK_DEMO_MARKER string below (see ci.yml
// "Verify demo code absent") — it is embedded in an actual string literal
// below (not just this comment) because minifiers strip comments in every
// build mode, comment-only sentinels would never survive to dist/.

/**
 * Demo-mode replacement for the fetch call in api/client.js request().
 * Same contract: resolves to { data, error }.
 */
export async function demoRequest(path, options = {}) {
  return {
    data: null,
    error: `LICENSETRACK_DEMO_MARKER: no handler for ${options.method ?? "GET"} ${path}`,
  };
}

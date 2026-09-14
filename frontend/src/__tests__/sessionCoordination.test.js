import { beforeEach, afterEach, expect, test, vi } from "vitest";

beforeEach(() => { vi.resetModules(); window.localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
const response = (data, status = 200) => ({ status, ok: status < 400, headers: new Headers({ "Content-Type": "application/json" }), json: async () => data });

test("protected requests wait for refresh and use cookies without stale bearer credentials", async () => {
  const client = await import("../api/client.js");
  const auth = await import("../api/auth.js");
  let finish;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(response({ id: 1 }));
  vi.stubGlobal("fetch", fetch);
  const refresh = auth.refreshSession();
  const protectedRequest = client.get("/api/users/me");
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response({ access_token: "demo-token" }));
  await refresh;
  await protectedRequest;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].credentials).toBe("include");
  expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
});

test("late refresh cannot unlock logout, and a failed logout cannot bootstrap the account", async () => {
  const client = await import("../api/client.js");
  const auth = await import("../api/auth.js");
  let finish;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const refresh = auth.refreshSession();
  await auth.logoutSession();
  finish(response({ access_token: "demo-token" }));
  await refresh;
  expect(client.isSessionLocked()).toBe(true);
  expect((await auth.getSession()).data.authenticated).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.resetModules();
  expect((await import("../api/client.js")).isSessionLocked()).toBe(true);
});


test("a cross-site API uses bearer authentication when cookies are unavailable", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.another-site.example");
  try {
    const client = await import("../api/client.js");
    client.setToken("split-session-token");
    const fetch = vi.fn().mockResolvedValue(response({ id: 1 }));
    vi.stubGlobal("fetch", fetch);
    expect((await client.get("/api/users/me")).error).toBeNull();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer split-session-token");
  } finally {
    vi.unstubAllEnvs();
  }
});


test("a refresh finishing after logout and split-site login cannot replace the new bearer", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.another-site.example");
  try {
    const client = await import("../api/client.js");
    const auth = await import("../api/auth.js");
    let finish;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response({ access_token: "new-login-token", user: { id: 1 } }));
    vi.stubGlobal("fetch", fetch);
    client.setToken("old-token");
    const refresh = auth.refreshSession();
    await auth.logoutSession();
    await auth.login("admin", "password");
    finish(response({ access_token: "old-refresh-token" }));
    await refresh;
    expect(client.getToken()).toBe("new-login-token");
    expect(client.isSessionLocked()).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});

test("tabs accept refresh tokens only for their existing session identity", async () => {
  const channels = [];
  vi.stubGlobal("BroadcastChannel", class {
    constructor() { channels.push(this); }
    postMessage() {}
  });
  const clientA = await import("../api/client.js");
  vi.resetModules();
  const clientB = await import("../api/client.js");
  const jwt = (sessionId, exp) => `header.${window.btoa(JSON.stringify({ session_id: sessionId, exp }))}.signature`;
  const old = jwt("shared-session", 100);
  const refreshed = jwt("shared-session", 200);
  clientA.setToken(old);
  clientB.setToken(old);
  channels[1].onmessage({ data: { token: refreshed } });
  expect(clientB.getToken()).toBe(refreshed);
  channels[1].onmessage({ data: { token: old } });
  expect(clientB.getToken()).toBe(refreshed);
  clientB.setToken(jwt("new-login", 300));
  channels[1].onmessage({ data: { token: refreshed } });
  expect(clientB.getToken()).toBe(jwt("new-login", 300));
});


test("split deployment expiry follows each tab's bearer despite another tab's login or cleanup", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.another-site.example");
  try {
    const olderTab = await import("../api/client.js");
    vi.resetModules();
    const newerTab = await import("../api/client.js");
    const jwt = (sessionId, exp) => `header.${window.btoa(JSON.stringify({ session_id: sessionId, exp }))}.signature`;
    olderTab.setToken(jwt("older-session", 100));
    newerTab.setToken(jwt("newer-session", 200));
    expect(window.localStorage.getItem("licensetrack.session.expiry")).toBe("200000");
    expect(olderTab.getSessionExpiry()).toBe(100000);
    expect(newerTab.getSessionExpiry()).toBe(200000);
    newerTab.clearToken();
    expect(olderTab.getSessionExpiry()).toBe(100000);
    olderTab.setToken(jwt("older-session", 300));
    expect(olderTab.getSessionExpiry()).toBe(300000);
  } finally { vi.unstubAllEnvs(); }
});

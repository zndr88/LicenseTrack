import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { logoutSession } from "../../api/auth.js";
import { clearToken, request, setToken } from "../../api/client.js";

const mockJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: vi.fn(() => "application/json") },
  json: vi.fn().mockResolvedValue(body),
});

beforeEach(() => {
  clearToken();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication API", () => {
  test("clears the in-memory token even when server logout fails", async () => {
    setToken("session-token");
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ detail: "Logout failed" }, 500))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    await expect(logoutSession()).resolves.toEqual({ error: "Logout failed" });
    await request("/api/test");

    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer session-token");
    expect(global.fetch.mock.calls[1][1].headers).not.toHaveProperty("Authorization");
  });
});

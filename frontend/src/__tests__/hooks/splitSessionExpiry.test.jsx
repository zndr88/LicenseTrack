import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.hoisted(() => { vi.stubEnv("VITE_API_URL", "https://api.another-site.example"); });
vi.mock("../../api/auth.js", () => ({ getSession: vi.fn(), refreshSession: vi.fn(), logoutSession: vi.fn() }));

import { useAuth } from "../../hooks/useAuth.js";
import { getSessionExpiry, setToken, unlockSession, clearToken } from "../../api/client.js";
import * as authApi from "../../api/auth.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
  clearToken();
  unlockSession();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const jwt = (sessionId, expiresAt) => `header.${window.btoa(JSON.stringify({ session_id: sessionId, exp: expiresAt / 1000 }))}.signature`;

test("another login's later expiry cannot postpone the older tab's scheduled bearer refresh", async () => {
  const expiry = Date.now() + 30 * 60_000;
  setToken(jwt("older-session", expiry));
  authApi.getSession.mockResolvedValue({ data: {
    authenticated: true, user: { id: 1, username: "admin", role: "admin" },
  } });
  authApi.refreshSession.mockImplementation(async () => {
    setToken(jwt("older-session", Date.now() + 30 * 60_000));
    return { data: {}, error: null };
  });
  const queryClient = new QueryClient();
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useAuth({ sessionTimeout: 30, showToast: vi.fn() }), { wrapper });
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    vi.advanceTimersByTime(10 * 60_000);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    await Promise.resolve();
  });
  // A separate login writes its later expiry, but its token stays in the other tab.
  window.localStorage.setItem("licensetrack.session.expiry", String(expiry + 10 * 60_000));
  await act(async () => {
    vi.advanceTimersByTime(19 * 60_000);
    await Promise.resolve();
  });
  expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  expect(getSessionExpiry()).toBeGreaterThan(expiry);
  expect(result.current.currentUser?.username).toBe("admin");
  expect(authApi.logoutSession).not.toHaveBeenCalled();
});

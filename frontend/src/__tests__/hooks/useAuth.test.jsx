import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useSessionTimeout } from "../../hooks/useSessionTimeout.js";
import { useAuth } from "../../hooks/useAuth.js";
import * as authApi from "../../api/auth.js";

vi.mock("../../api/auth.js", () => ({
  getSession: vi.fn(),
  logoutSession: vi.fn(),
  refreshSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAuth", () => {
  function renderAuthHook(options) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { ...renderHook(() => useAuth(options), { wrapper }), queryClient };
  }

  test("inactivity timeout clears the server session before dropping local auth state", async () => {
    vi.useFakeTimers();
    const showToast = vi.fn();
    authApi.getSession.mockResolvedValueOnce({
      data: {
        authenticated: true,
        user: {
          id: 1,
          username: "admin",
          role: "admin",
          allow_downloads: true,
          must_change_password: false,
          auth_provider: "local",
          is_break_glass_admin: false,
        },
      },
      error: null,
    });
    authApi.getSession.mockResolvedValue({ data: { authenticated: false, user: null }, error: null });
    authApi.logoutSession.mockResolvedValue({ error: null });

    const { result, queryClient } = renderAuthHook({ sessionTimeout: 1, showToast });
    queryClient.setQueryData(["licenses"], ["cached license"]);

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.currentUser?.username).toBe("admin");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(authApi.logoutSession).toHaveBeenCalledTimes(1);
    expect(authApi.getSession).toHaveBeenCalledTimes(1);
    expect(result.current.currentUser).toBeNull();
    expect(queryClient.getQueryData(["licenses"])).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("Session expired due to inactivity.", "info");
  });

  test("active sessions rotate their token before the server lifetime expires", async () => {
    vi.useFakeTimers();
    authApi.getSession.mockResolvedValueOnce({
      data: {
        authenticated: true,
        user: {
          id: 1,
          username: "admin",
          role: "admin",
          must_change_password: false,
          auth_provider: "local",
        },
      },
      error: null,
    });
    authApi.refreshSession.mockResolvedValue({ data: { access_token: "rotated" }, error: null });

    const { result } = renderAuthHook({ sessionTimeout: 1, showToast: vi.fn() });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new KeyboardEvent("keydown"));
      await Promise.resolve();
    });
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new MouseEvent("mousedown"));
      await Promise.resolve();
    });

    expect(authApi.refreshSession).toHaveBeenCalledTimes(2);
    expect(authApi.logoutSession).not.toHaveBeenCalled();
    expect(result.current.currentUser?.username).toBe("admin");
  });

  test("explicit logout clears local auth state after requesting server cleanup", async () => {
    window.sessionStorage.setItem("licensetrack.licenses.dismissedAttentionIds", "[12,34]");
    authApi.getSession.mockResolvedValueOnce({
      data: {
        authenticated: true,
        user: {
          id: 1,
          username: "admin",
          role: "admin",
          must_change_password: false,
          auth_provider: "local",
        },
      },
      error: null,
    });
    authApi.getSession.mockResolvedValue({ data: { authenticated: false, user: null }, error: null });
    authApi.logoutSession.mockResolvedValue({ error: "Server cleanup failed" });
    const { result, queryClient } = renderAuthHook({ sessionTimeout: 0, showToast: vi.fn() });
    queryClient.setQueryData(["licenses"], ["cached license"]);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(authApi.logoutSession).toHaveBeenCalledTimes(1);
    expect(authApi.getSession).toHaveBeenCalledTimes(1);
    expect(result.current.currentUser).toBeNull();
    expect(queryClient.getQueryData(["licenses"])).toBeUndefined();
    expect(window.sessionStorage.getItem("licensetrack.licenses.dismissedAttentionIds")).toBeNull();
  });
});


test("panel scrolling counts as activity and an active sibling tab prevents idle logout", () => {
  vi.useFakeTimers();
  const timeout = vi.fn();
  const activity = vi.fn();
  const panel = document.createElement("div");
  document.body.append(panel);
  renderHook(() => useSessionTimeout(1, timeout, activity));
  act(() => {
    vi.advanceTimersByTime(30_000);
    panel.dispatchEvent(new Event("scroll", { bubbles: false }));
    vi.advanceTimersByTime(20_000);
    window.localStorage.setItem("licensetrack.session.activity", String(Date.now()));
    vi.advanceTimersByTime(40_000);
  });
  expect(activity).toHaveBeenCalled();
  expect(timeout).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(20_000));
  expect(timeout).toHaveBeenCalledTimes(1);
  panel.remove();
});


test.each(["sparse activity", "reload near expiry"])("refreshes before expiry after %s without another click", async (scenario) => {
  vi.useFakeTimers();
  const started = Date.now();
  const expiresAt = started + (scenario === "sparse activity" ? 30 * 60_000 : 60_000);
  authApi.getSession.mockResolvedValue({ data: {
    authenticated: true, expires_at: expiresAt / 1000,
    user: { id: 1, username: "admin", role: "admin" },
  } });
  authApi.refreshSession.mockImplementation(async () => {
    window.localStorage.setItem("licensetrack.session.expiry", String(Date.now() + 30 * 60_000));
    return { data: {}, error: null };
  });
  const queryClient = new QueryClient();
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  renderHook(() => useAuth({ sessionTimeout: 30, showToast: vi.fn() }), { wrapper });
  await act(async () => { await Promise.resolve(); });
  if (scenario === "sparse activity") {
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(authApi.refreshSession).not.toHaveBeenCalled();
  }
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown"));
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(expiresAt - Date.now());
    await Promise.resolve();
  });
  expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  expect(authApi.logoutSession).not.toHaveBeenCalled();
});

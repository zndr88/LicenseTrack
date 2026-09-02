import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAuth", () => {
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

    const { result } = renderHook(() => useAuth({ sessionTimeout: 1, showToast }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.currentUser?.username).toBe("admin");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(authApi.logoutSession).toHaveBeenCalledTimes(1);
    expect(result.current.currentUser).toBeNull();
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

    const { result } = renderHook(() => useAuth({ sessionTimeout: 1, showToast: vi.fn() }));
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
    const { result } = renderHook(() => useAuth({ sessionTimeout: 0, showToast: vi.fn() }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(authApi.logoutSession).toHaveBeenCalledTimes(1);
    expect(result.current.currentUser).toBeNull();
    expect(window.sessionStorage.getItem("licensetrack.licenses.dismissedAttentionIds")).toBeNull();
  });
});

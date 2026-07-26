import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useAuth } from "../../hooks/useAuth.js";
import * as authApi from "../../api/auth.js";

vi.mock("../../api/auth.js", () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  logoutSession: vi.fn(),
}));

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
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(result.current.currentUser).toBeNull();
    expect(showToast).toHaveBeenCalledWith("Session expired due to inactivity.", "info");
  });
});

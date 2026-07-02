import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

import { useAppNavigation } from "../../hooks/useAppNavigation.js";
import { useIdleRefresh } from "../../hooks/useIdleRefresh.js";
import { queryKeys } from "../../queryKeys.js";

vi.mock("../../hooks/useIdleRefresh.js", () => ({
  useIdleRefresh: vi.fn(),
}));

function wrapperWithClient(queryClient) {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAppNavigation", () => {
  test("restores swimlane stats after closing a selected license", () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => useAppNavigation({ currentUser: { role: "admin" }, setUserSettings: vi.fn() }),
      { wrapper: wrapperWithClient(queryClient) },
    );

    expect(result.current.statsVisible).toBe(true);

    act(() => result.current.handleSetSelectedId(12));
    expect(result.current.selectedId).toBe(12);
    expect(result.current.statsVisible).toBe(false);

    act(() => result.current.handleSetSelectedId(null));
    expect(result.current.selectedId).toBeNull();
    expect(result.current.statsVisible).toBe(true);
  });

  test("viewer users are redirected away from restricted pages", () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => useAppNavigation({ currentUser: { role: "viewer" }, setUserSettings: vi.fn() }),
      { wrapper: wrapperWithClient(queryClient) },
    );

    act(() => result.current.setPage("admin"));

    expect(result.current.page).toBe("licenses");
  });

  test("idle refresh invalidates the cache matching the active page", () => {
    let idleCallback;
    useIdleRefresh.mockImplementation((callback) => { idleCallback = callback; });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useAppNavigation({ currentUser: { role: "admin" }, setUserSettings: vi.fn() }),
      { wrapper: wrapperWithClient(queryClient) },
    );

    act(() => result.current.setPage("pending-orders"));
    act(() => idleCallback());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pendingOrders });
  });
});

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useIdleRefresh } from "../../hooks/useIdleRefresh.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { useNavigationGuard } from "../../hooks/useNavigationGuard.js";
import { useSessionTimeout } from "../../hooks/useSessionTimeout.js";
import { useToast } from "../../hooks/useToast.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guard and timer hooks", () => {
  test("useNavigationGuard blocks dirty navigation and unregisters on unmount", () => {
    const registered = { current: null };
    const navGuard = {
      navigate: vi.fn(),
      registerNavGuard: vi.fn((fn) => { registered.current = fn; }),
    };
    const onBlockedNavigate = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ anyDirty }) => useNavigationGuard({ anyDirty, navGuard, onBlockedNavigate }),
      { initialProps: { anyDirty: true } },
    );

    act(() => registered.current("admin"));
    expect(onBlockedNavigate).toHaveBeenCalledWith("admin");
    expect(navGuard.navigate).not.toHaveBeenCalled();

    rerender({ anyDirty: false });
    act(() => registered.current("reports"));
    expect(navGuard.navigate).toHaveBeenCalledWith("reports");

    unmount();
    expect(navGuard.registerNavGuard).toHaveBeenLastCalledWith(null);
  });

  test("useModalGuard opens discard confirmation for dirty closes and intercepts Escape", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ isDirty }) => useModalGuard({ isDirty, onClose }),
      { initialProps: { isDirty: false } },
    );

    act(() => result.current.requestClose());
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender({ isDirty: true });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.showDiscardDialog).toBe(true);
  });

  test("useSessionTimeout resets its timeout on user activity", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    renderHook(() => useSessionTimeout(1, onTimeout));

    act(() => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new KeyboardEvent("keydown"));
      vi.advanceTimersByTime(59_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test("useIdleRefresh fires only when enabled and the tab is visible", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get");
    visibilitySpy.mockReturnValue("hidden");

    const { rerender } = renderHook(
      ({ enabled }) => useIdleRefresh(callback, { idleMs: 1000, enabled }),
      { initialProps: { enabled: false } },
    );

    act(() => vi.advanceTimersByTime(1000));
    expect(callback).not.toHaveBeenCalled();

    rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(callback).not.toHaveBeenCalled();

    visibilitySpy.mockReturnValue("visible");
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("useToast shows typed messages, supports actions, dismisses, and auto-clears", () => {
    vi.useFakeTimers();
    const action = { label: "Undo", onClick: vi.fn() };
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("Saved", action));
    expect(result.current.toast).toEqual({ msg: "Saved", type: "success", action });

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeNull();

    act(() => result.current.showError("Failed"));
    expect(result.current.toast).toMatchObject({ msg: "Failed", type: "error" });

    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.toast).toBeNull();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "../../hooks/useToast.js";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the toast after 4 seconds", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("Saved"));
    expect(result.current.toast).toEqual({ msg: "Saved", type: "success", action: null });

    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.toast).toBeNull();
  });

  it("does not let an earlier toast's timer clear a newer toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("First"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.showError("Second"));

    // The first toast's timer would have fired here.
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.toast?.msg).toBe("Second");

    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.toast).toBeNull();
  });

  it("cancels the pending timer on unmount", () => {
    const { result, unmount } = renderHook(() => useToast());

    act(() => result.current.showToast("Pending"));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending timer when dismissed", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showToast("Pending"));
    act(() => result.current.dismissToast());

    expect(result.current.toast).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

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

  it("clears a success message after 5 seconds", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("Saved"));
    expect(result.current.toast).toEqual({ msg: "Saved", type: "success", action: null });

    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it.each(["error", "warning"])("keeps a %s message until it is dismissed", (type) => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showToast("Saved, but the upload failed", type));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toast).toMatchObject({ msg: "Saved, but the upload failed", type });

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeNull();
  });

  it("does not let an earlier message's timer clear a newer one", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("First"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.showSuccess("Second"));

    // The first message's timer would have fired here.
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.toast?.msg).toBe("Second");

    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.toast).toBeNull();
  });

  it("does not let a success message's timer clear the error that replaced it", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showSuccess("Saved"));
    act(() => result.current.showError("Failed"));

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toast?.msg).toBe("Failed");
  });

  it("uses the given default type when none is passed", () => {
    const { result } = renderHook(() => useToast({ defaultType: "success" }));

    act(() => result.current.showToast("Quote uploaded."));
    expect(result.current.toast?.type).toBe("success");
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

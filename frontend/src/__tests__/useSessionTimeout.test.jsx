import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSessionTimeout } from "../hooks/useSessionTimeout.js";
import DocumentPreviewPanel from "../components/ui/DocumentPreviewPanel.jsx";

function Harness({ onTimeout, withPreview = true }) {
  useSessionTimeout(1, onTimeout);
  return withPreview ? (
    <>
      <button type="button">elsewhere</button>
      <DocumentPreviewPanel filename="x.pdf" kind="pdf" url="blob:x" />
    </>
  ) : <div />;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSessionTimeout", () => {
  test("times out after the idle period", () => {
    const onTimeout = vi.fn();
    render(<Harness onTimeout={onTimeout} withPreview={false} />);
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test("reading a focused document preview counts as activity", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const onTimeout = vi.fn();
    const { container } = render(<Harness onTimeout={onTimeout} />);
    const frame = container.querySelector("iframe");
    const elsewhere = container.querySelector("button");
    act(() => { frame.focus(); });
    expect(document.activeElement).toBe(frame);

    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => { elsewhere.focus(); });
    expect(document.activeElement).toBe(elsewhere);
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test("a focused frame outside a document preview does not count", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const onTimeout = vi.fn();
    const Other = () => {
      useSessionTimeout(1, onTimeout);
      return <iframe title="other" />;
    };
    const { container } = render(<Other />);
    act(() => { container.querySelector("iframe").focus(); });
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../../utils/copyText.js";

function stubClipboard(value) {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value });
}

afterEach(() => {
  stubClipboard(undefined);
  delete document.execCommand;
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("copies through the browser clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue();
    stubClipboard({ writeText });

    expect(await copyText("PO-001")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("PO-001");
  });

  it("falls back to the older copy command on a plain-http address", async () => {
    stubClipboard(undefined);
    let copied = null;
    document.execCommand = vi.fn(() => {
      copied = document.activeElement.value;
      return true;
    });

    expect(await copyText("PO-001")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("PO-001");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the browser refuses the clipboard", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    document.execCommand = vi.fn(() => true);

    expect(await copyText("PO-001")).toBe(true);
  });

  it("reports failure when nothing works", async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn(() => false);

    expect(await copyText("PO-001")).toBe(false);
  });

  it("puts the focus back where it was after the fallback", async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn(() => true);
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    await copyText("PO-001");

    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

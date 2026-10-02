import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/uploads.js", () => ({ getUploadTypes: vi.fn() }));

import { getUploadTypes } from "../../api/uploads.js";
import { resetUploadAcceptCache, useUploadAccept } from "../../hooks/useUploadAccept.js";

afterEach(() => {
  resetUploadAcceptCache();
  getUploadTypes.mockReset();
});

describe("useUploadAccept", () => {
  it("turns the server's extensions into an accept attribute, loading them once", async () => {
    getUploadTypes.mockResolvedValue({ data: { extensions: [".lic", ".msg", ".pdf"] }, error: null });
    const first = renderHook(() => useUploadAccept());
    expect(first.result.current).toBeUndefined();
    await waitFor(() => expect(first.result.current).toBe(".lic,.msg,.pdf"));
    const second = renderHook(() => useUploadAccept());
    expect(second.result.current).toBe(".lic,.msg,.pdf");
    expect(getUploadTypes).toHaveBeenCalledTimes(1);
  });

  it("leaves the picker open to every file when the request fails", async () => {
    getUploadTypes.mockResolvedValue({ data: null, error: "Network error" });
    const { result } = renderHook(() => useUploadAccept());
    await waitFor(() => expect(getUploadTypes).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});

// Every non-test source file, as raw text.
const sources = import.meta.glob(["../../**/*.{js,jsx}", "!../../__tests__/**", "!../../**/__tests__/**"], {
  query: "?raw", import: "default", eager: true,
});

describe("document file pickers", () => {
  it("never hard-code their own list of accepted extensions", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources)
      .filter(([, text]) => /accept="\.pdf/.test(text))
      .map(([path]) => path.replace(/^(\.\.\/)+/, ""));
    expect(offenders).toEqual([]);
  });
});

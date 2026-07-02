import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/csvImport.js", () => ({
  previewCsvImport: vi.fn(),
  confirmCsvImport: vi.fn(),
}));

import { confirmCsvImport } from "../../api/csvImport.js";
import { useCSVImportPreview } from "../../hooks/useCSVImportPreview.js";

describe("useCSVImportPreview — handleConfirmImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmCsvImport.mockResolvedValue({
      data: { importedCount: 1, skippedCount: 0, errorCount: 0, errors: [] },
      error: null,
    });
  });

  it("passes acknowledgeWarnings=false to confirmCsvImport by default", async () => {
    const setStep = vi.fn();
    const onImportComplete = vi.fn();
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn(), onImportComplete })
    );

    await act(async () => {
      await result.current.handleConfirmImport(new File([""], "test.csv"), false);
    });

    expect(confirmCsvImport).toHaveBeenCalledWith(
      expect.any(File),
      [],
      false,
      undefined,
    );
    expect(setStep).toHaveBeenCalledWith("done");
  });

  it("passes acknowledgeWarnings=true when specified", async () => {
    const setStep = vi.fn();
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn() })
    );

    await act(async () => {
      await result.current.handleConfirmImport(new File([""], "test.csv"), true);
    });

    expect(confirmCsvImport).toHaveBeenCalledWith(
      expect.any(File),
      [],
      true,
      undefined,
    );
  });

  it("passes declared import formats to confirmCsvImport", async () => {
    const setStep = vi.fn();
    const importFormats = { numberFormatLocale: "nl-BE", dateFormat: "DD/MM/YYYY" };
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn(), importFormats })
    );

    await act(async () => {
      await result.current.handleConfirmImport(new File([""], "test.csv"));
    });

    expect(confirmCsvImport).toHaveBeenCalledWith(
      expect.any(File),
      [],
      false,
      importFormats,
    );
  });
});

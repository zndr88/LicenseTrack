import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/csvImport.js", () => ({
  previewCsvImport: vi.fn(),
  confirmCsvImport: vi.fn(),
}));

import { confirmCsvImport, previewCsvImport } from "../../api/csvImport.js";
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
      false,
      [],
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
      false,
      [],
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
      false,
      [],
    );
  });

  it("auto-enables native LT Ref updates and forwards the choice on confirm", async () => {
    previewCsvImport.mockResolvedValue({
      data: { headersFound: ["license_ref"], rows: [], validRows: 0 },
      error: null,
    });
    const setStep = vi.fn();
    const file = new File(["LT Ref\nLT-2026-00001"], "native.csv");
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn() })
    );

    await act(async () => {
      await result.current.handleFilePreview(file);
    });
    expect(previewCsvImport).toHaveBeenCalledWith(file, undefined, true);
    expect(result.current.updateExisting).toBe(true);

    await act(async () => {
      await result.current.handleConfirmImport(file);
    });
    expect(confirmCsvImport).toHaveBeenCalledWith(file, [], false, undefined, true, []);
  });

  it("passes selected maintenance parent row overrides to confirmCsvImport", async () => {
    const setStep = vi.fn();
    const file = new File(["publisher_name,software_description,license_type\nAcme,Support,maintenance"], "test.csv");
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn() })
    );

    act(() => {
      result.current.setMaintenanceParentOverride(3, 42);
    });

    await act(async () => {
      await result.current.handleConfirmImport(file);
    });

    expect(confirmCsvImport).toHaveBeenCalledWith(
      file,
      [],
      false,
      undefined,
      false,
      [{ rowNumber: 3, parentLicenseId: 42 }],
    );
  });
});

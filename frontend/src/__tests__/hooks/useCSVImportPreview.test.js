import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/csvImport.js", () => ({
  previewCsvImport: vi.fn(),
  confirmCsvImport: vi.fn(),
}));

import { confirmCsvImport, previewCsvImport } from "../../api/csvImport.js";
import {
  isMaintenanceParentError,
  rowHasOnlyMaintenanceParentError,
  rowNeedsMaintenanceParent,
  serializeImportRowOverrides,
  useCSVImportPreview,
} from "../../hooks/useCSVImportPreview.js";

describe("maintenance-parent preview predicates", () => {
  const parentError = "Maintenance rows require a 'parent_license_ref' column";

  it("classifies parent errors for maintenance rows only", () => {
    expect(isMaintenanceParentError(parentError)).toBe(true);
    expect(isMaintenanceParentError("Maintenance parent is required")).toBe(true);
    expect(isMaintenanceParentError("Invalid date")).toBe(false);
    expect(rowNeedsMaintenanceParent({
      licenseType: "maintenance",
      importStatus: "error",
      validationErrors: [parentError],
    })).toBe(true);
    expect(rowNeedsMaintenanceParent({
      licenseType: "subscription",
      importStatus: "error",
      validationErrors: [parentError],
    })).toBe(false);
  });

  it("distinguishes parent-only failures from mixed validation failures", () => {
    const row = {
      licenseType: "maintenance",
      importStatus: "error",
      validationErrors: [parentError],
    };
    expect(rowHasOnlyMaintenanceParentError(row)).toBe(true);
    expect(rowHasOnlyMaintenanceParentError({
      ...row,
      validationErrors: [parentError, "Invalid date"],
    })).toBe(false);
  });
});

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
    expect(confirmCsvImport).toHaveBeenCalledWith(file, [], false, undefined, true, [], []);
  });

  it("passes selected maintenance parent row overrides to confirmCsvImport", async () => {
    const setStep = vi.fn();
    const file = new File(["publisher_name,software_description,license_type\nAcme,Support,maintenance"], "test.csv");
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn() })
    );

    act(() => {
      result.current.setMaintenanceParentAction(3, "link_existing", 42);
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
      [{ rowNumber: 3, action: "link_existing", parentLicenseId: 42 }],
      [],
    );
  });

  it("passes the explicit legacy-unlinked action without a parent id", async () => {
    const setStep = vi.fn();
    const file = new File(["license_type\nmaintenance"], "legacy.csv");
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep, setLoading: vi.fn(), setError: vi.fn() })
    );

    act(() => {
      result.current.setMaintenanceParentAction(7, "import_legacy_unlinked");
    });
    await act(async () => {
      await result.current.handleConfirmImport(file, true);
    });

    expect(confirmCsvImport).toHaveBeenCalledWith(
      file,
      [],
      true,
      undefined,
      false,
      [{ rowNumber: 7, action: "import_legacy_unlinked" }],
      [],
    );
  });

  it("omits skipped link and legacy overrides from native and mapped payload serialization", () => {
    const overrides = {
      3: { action: "link_existing", parentLicenseId: 42 },
      4: { action: "link_existing" },
      5: { action: "import_legacy_unlinked" },
    };
    expect(serializeImportRowOverrides(overrides, new Set([4, 5]))).toEqual([
      { rowNumber: 3, action: "link_existing", parentLicenseId: 42 },
    ]);
    expect(serializeImportRowOverrides(overrides, [4, 5])).toEqual([
      { rowNumber: 3, action: "link_existing", parentLicenseId: 42 },
    ]);
  });

  it("clears an override when skipped so restoring does not reveal a hidden invalid action", () => {
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep: vi.fn(), setLoading: vi.fn(), setError: vi.fn() })
    );
    act(() => {
      result.current.setMaintenanceParentAction(4, "link_existing");
      result.current.skipRows([4]);
    });
    expect(result.current.rowOverrides).toEqual({});
    act(() => result.current.restoreRows([4]));
    expect(result.current.rowOverrides).toEqual({});
  });

  it("bulk applies and clears only eligible maintenance creates and tracks eligibility through skip/restore", () => {
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep: vi.fn(), setLoading: vi.fn(), setError: vi.fn() })
    );
    act(() => result.current.setMappedPreviewData({ rows: [
      { rowNumber: 1, licenseType: "maintenance", importAction: "create", importStatus: "active", validationErrors: [] },
      { rowNumber: 2, licenseType: "maintenance", importAction: "create", importStatus: "error", validationErrors: ["Maintenance parent is required"] },
      { rowNumber: 3, licenseType: "maintenance", importAction: "update", importStatus: "active", validationErrors: [] },
      { rowNumber: 4, licenseType: "maintenance", importAction: "create", importStatus: "active", validationErrors: [] },
      { rowNumber: 5, licenseType: "maintenance", importAction: "create", importStatus: "error", validationErrors: ["Maintenance parent is required", "Invalid date"] },
    ] }));

    expect(result.current.legacyUnlinkedEligibleCount).toBe(3);
    act(() => result.current.skipRows([4]));
    expect(result.current.legacyUnlinkedEligibleCount).toBe(2);
    act(() => result.current.restoreRows([4]));
    expect(result.current.legacyUnlinkedEligibleCount).toBe(3);
    act(() => result.current.applyLegacyUnlinkedToEligible());
    expect(result.current.rowOverrides).toEqual({
      1: { action: "import_legacy_unlinked" },
      2: { action: "import_legacy_unlinked" },
      4: { action: "import_legacy_unlinked" },
    });
    expect(result.current.legacyUnlinkedSelectedCount).toBe(3);
    act(() => result.current.clearLegacyUnlinkedSelections());
    expect(result.current.rowOverrides).toEqual({});
    expect(result.current.legacyUnlinkedSelectedCount).toBe(0);
  });

  it("cascades a skipped inferred parent to its same-file maintenance children", () => {
    const { result } = renderHook(() =>
      useCSVImportPreview({ setStep: vi.fn(), setLoading: vi.fn(), setError: vi.fn() })
    );
    act(() => result.current.setMappedPreviewData({ rows: [
      { rowNumber: 1, importStatus: "active", importAction: "create" },
      { rowNumber: 2, importStatus: "active", importAction: "create", inferredParentRowNumber: 1 },
      { rowNumber: 3, importStatus: "active", importAction: "create", inferredParentRowNumber: 2 },
    ] }));

    act(() => result.current.skipRows([1]));

    expect(result.current.skippedRows).toEqual(new Set([1, 2, 3]));
    expect(result.current.importableRowsCount).toBe(0);
  });
});

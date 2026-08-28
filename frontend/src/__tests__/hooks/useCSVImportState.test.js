import { renderHook, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useCSVImportState } from "../../hooks/useCSVImportState.js";
import { getLicenses } from "../../api/licenses.js";
import { useCSVImportAnalysis } from "../../hooks/useCSVImportAnalysis.js";
import { useCSVImportPreview } from "../../hooks/useCSVImportPreview.js";

vi.mock("../../api/licenses.js", () => ({ getLicenses: vi.fn() }));
vi.mock("../../hooks/useCSVImportAnalysis.js", () => ({ useCSVImportAnalysis: vi.fn() }));
vi.mock("../../hooks/useCSVImportPreview.js", async () => {
  const actual = await vi.importActual("../../hooks/useCSVImportPreview.js");
  return { ...actual, useCSVImportPreview: vi.fn() };
});

const file = new File(["license_type\nmaintenance"], "import.csv");

function previewMock(overrides = {}) {
  return {
    previewData: { warningSummary: { hasWarnings: false } },
    skippedRows: new Set([9]),
    rowOverrides: {
      7: { action: "import_legacy_unlinked" },
      9: { action: "link_existing", parentLicenseId: 42 },
    },
    referenceOverrides: {},
    selectedRows: new Set(),
    duplicateWarningCount: 0,
    importableRowsCount: 1,
    allSelectableSelected: false,
    selectableRows: [],
    selectedImportableRows: [],
    selectedRowsToSkip: [],
    selectedRowsToRestore: [],
    toggleSelectedRow: vi.fn(),
    toggleAllSelectableRows: vi.fn(),
    skipRows: vi.fn(),
    restoreRows: vi.fn(),
    setMaintenanceParentAction: vi.fn(),
    applyLegacyUnlinkedToEligible: vi.fn(),
    clearLegacyUnlinkedSelections: vi.fn(),
    legacyUnlinkedSelectedCount: 1,
    legacyUnlinkedEligibleCount: 1,
    setReferenceOverride: vi.fn(),
    handleFilePreview: vi.fn(),
    handleConfirmImport: vi.fn(),
    handleUpdateExisting: vi.fn(),
    setMappedPreviewData: vi.fn(),
    resetPreview: vi.fn(),
    setConfirmResult: vi.fn(),
    updateExisting: false,
    ...overrides,
  };
}

function analysisMock(overrides = {}) {
  return {
    analyzeData: null,
    columnDecisions: {},
    savedMappings: [],
    selectedMappingId: null,
    setSelectedMappingId: vi.fn(),
    loadingMappings: false,
    customFieldDefs: [],
    mappingName: "",
    setMappingName: vi.fn(),
    creatingFields: false,
    showMatched: false,
    setShowMatched: vi.fn(),
    updateExisting: false,
    setUpdateExisting: vi.fn(),
    activeMatchedColumns: [],
    allUnrecognizedColumns: [],
    matchedInternalFields: new Set(),
    allResolved: true,
    updateDecision: vi.fn(),
    handleUnmatch: vi.fn(),
    handleCreateField: vi.fn(),
    handleAnalyze: vi.fn(),
    handleMappedPreview: vi.fn(),
    handleExecuteImport: vi.fn(),
    resetAnalysis: vi.fn(),
    ...overrides,
  };
}

describe("useCSVImportState confirmation wiring", () => {
  test("native confirmation acknowledges legacy selections and omits skipped overrides", async () => {
    getLicenses.mockResolvedValue({ data: [] });
    const preview = previewMock();
    const analysis = analysisMock();
    useCSVImportPreview.mockReturnValue(preview);
    useCSVImportAnalysis.mockReturnValue(analysis);
    const { result } = renderHook(() => useCSVImportState({}));

    await act(async () => result.current.handleFile(file));
    await act(async () => result.current.handleConfirm());

    expect(preview.handleConfirmImport).toHaveBeenCalledWith(file, true);
    expect(analysis.handleExecuteImport).not.toHaveBeenCalled();
  });

  test("mapped confirmation acknowledges legacy selections and sends action objects without skipped rows", async () => {
    getLicenses.mockResolvedValue({ data: [] });
    const preview = previewMock();
    const analysis = analysisMock({ analyzeData: { matchedColumns: [] } });
    useCSVImportPreview.mockReturnValue(preview);
    useCSVImportAnalysis.mockReturnValue(analysis);
    const { result } = renderHook(() => useCSVImportState({}));

    act(() => result.current.setSource("external"));
    await act(async () => result.current.handleFile(file));
    await act(async () => result.current.handleConfirm());

    expect(analysis.handleExecuteImport).toHaveBeenCalledWith(
      file,
      new Set([9]),
      preview.setConfirmResult,
      true,
      [{ rowNumber: 7, action: "import_legacy_unlinked" }],
      [],
    );
  });
});

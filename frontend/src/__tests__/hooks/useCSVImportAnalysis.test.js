import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/settings.js", () => ({
  listCustomFields: vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null }),
  createCustomField: vi.fn().mockResolvedValue({ data: { fieldKey: "cf_new" }, error: null }),
}));

vi.mock("../../api/csvImport.js", () => ({
  analyzeImport: vi.fn(),
  executeImport: vi.fn(),
  listImportMappings: vi.fn().mockResolvedValue({ data: [], error: null }),
  previewMappedImport: vi.fn(),
}));

import { listCustomFields, createCustomField } from "../../api/settings.js";
import { analyzeImport, executeImport, listImportMappings } from "../../api/csvImport.js";
import { useCSVImportAnalysis } from "../../hooks/useCSVImportAnalysis.js";

describe("useCSVImportAnalysis — handleCreateField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCustomFields.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    createCustomField.mockResolvedValue({ data: { fieldKey: "cf_new" }, error: null });
  });

  it("calls listCustomFields and createCustomField (not raw get/post)", async () => {
    const { result } = renderHook(() =>
      useCSVImportAnalysis({
        active: false,
        setStep: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      })
    );

    act(() => {
      result.current.updateDecision("MyCol", {
        action: "create",
        cfName: "My Column",
        cfType: "text",
        cfKey: null,
      });
    });

    await act(async () => {
      await result.current.handleCreateField("MyCol");
    });

    expect(listCustomFields).toHaveBeenCalled();
    expect(createCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Column", field_type: "text", display_order: 2 })
    );
  });
});

describe("useCSVImportAnalysis — updateExisting auto-arm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-arms updateExisting when license_ref is a matched column", async () => {
    analyzeImport.mockResolvedValue({
      data: {
        totalRows: 1,
        matchedColumns: [{ rawHeader: "LT Ref", internalField: "license_ref", sampleValues: ["LT-2026-00001"] }],
        unrecognizedColumns: [],
        missingRequired: [],
      },
      error: null,
    });

    const { result } = renderHook(() =>
      useCSVImportAnalysis({ active: true, setStep: vi.fn(), setLoading: vi.fn(), setError: vi.fn() })
    );

    await act(async () => {
      await result.current.handleAnalyze(new File(["x"], "a.csv"));
    });

    expect(result.current.updateExisting).toBe(true);
  });

  it("leaves updateExisting off when no license_ref column is matched", async () => {
    analyzeImport.mockResolvedValue({
      data: {
        totalRows: 1,
        matchedColumns: [{ rawHeader: "Publisher", internalField: "publisher_name", sampleValues: ["Acme"] }],
        unrecognizedColumns: [],
        missingRequired: [],
      },
      error: null,
    });

    const { result } = renderHook(() =>
      useCSVImportAnalysis({ active: true, setStep: vi.fn(), setLoading: vi.fn(), setError: vi.fn() })
    );

    await act(async () => {
      await result.current.handleAnalyze(new File(["x"], "a.csv"));
    });

    expect(result.current.updateExisting).toBe(false);
  });
});

describe("useCSVImportAnalysis shared preset permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImportMappings.mockResolvedValue({
      data: [{
        id: 7,
        name: "Shared preset",
        mapping: [{ rawHeader: "Vendor Name", target: "publisher_name" }],
      }],
      error: null,
    });
    analyzeImport.mockResolvedValue({
      data: {
        totalRows: 1,
        matchedColumns: [],
        unrecognizedColumns: [{ rawHeader: "Vendor Name", sampleValues: ["Acme"] }],
        missingRequired: ["software_description"],
      },
      error: null,
    });
    executeImport.mockResolvedValue({ data: {}, error: null });
  });

  it("lets editors use a shared preset without attempting to overwrite it", async () => {
    const { result } = renderHook(() =>
      useCSVImportAnalysis({
        active: true,
        setStep: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
        canManageImportMappings: false,
      })
    );
    await waitFor(() => expect(result.current.savedMappings).toHaveLength(1));

    act(() => result.current.setSelectedMappingId(7));
    const file = new File(["Vendor Name\nAcme"], "external.csv");
    await act(async () => result.current.handleAnalyze(file));
    await act(async () => result.current.handleExecuteImport(file, new Set(), vi.fn()));

    const payload = JSON.parse(executeImport.mock.calls[0][1]);
    expect(payload.mappingName).toBeNull();
    expect(payload.mapping).toEqual([{ rawHeader: "Vendor Name", target: "publisher_name" }]);
  });

  it("keeps loaded presets available after resetting the import flow", async () => {
    const { result } = renderHook(() =>
      useCSVImportAnalysis({
        active: true,
        setStep: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      })
    );
    await waitFor(() => expect(result.current.savedMappings).toHaveLength(1));

    act(() => result.current.setSelectedMappingId(7));
    act(() => result.current.resetAnalysis());

    expect(result.current.savedMappings).toHaveLength(1);
    expect(result.current.selectedMappingId).toBeNull();
    expect(listImportMappings).toHaveBeenCalledTimes(1);
  });
});

describe("useCSVImportAnalysis existing custom fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImportMappings.mockResolvedValue({ data: [], error: null });
    listCustomFields.mockResolvedValue({
      data: [{ id: 9, name: "Contract Owner", fieldKey: "cf_contract_owner", fieldType: "text" }],
      error: null,
    });
    analyzeImport.mockResolvedValue({
      data: {
        totalRows: 1,
        matchedColumns: [],
        unrecognizedColumns: [{ rawHeader: "Owner", sampleValues: ["Alice"] }],
        missingRequired: [],
      },
      error: null,
    });
    executeImport.mockResolvedValue({ data: {}, error: null });
  });

  it("maps an unrecognized column to an existing custom field", async () => {
    const { result } = renderHook(() =>
      useCSVImportAnalysis({
        active: true,
        setStep: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      })
    );
    await waitFor(() => expect(result.current.customFieldDefs).toHaveLength(1));

    const file = new File(["Owner\nAlice"], "external.csv");
    await act(async () => result.current.handleAnalyze(file));
    act(() => result.current.updateDecision("Owner", {
      action: "map",
      targetField: "cf_contract_owner",
    }));
    await act(async () => result.current.handleExecuteImport(file, new Set(), vi.fn()));

    const payload = JSON.parse(executeImport.mock.calls[0][1]);
    expect(payload.mapping).toEqual([{ rawHeader: "Owner", target: "cf_contract_owner" }]);
  });
});

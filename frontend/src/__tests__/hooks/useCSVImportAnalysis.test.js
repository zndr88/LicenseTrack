import { renderHook, act } from "@testing-library/react";
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

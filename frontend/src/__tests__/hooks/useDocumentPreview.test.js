import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../api/documents.js", () => ({
  downloadDocument: vi.fn(),
  downloadProcurementDocument: vi.fn(),
  previewDocument: vi.fn(),
  previewProcurementDocument: vi.fn(),
}));

import {
  downloadDocument,
  downloadProcurementDocument,
  previewDocument,
  previewProcurementDocument,
} from "../../api/documents.js";
import { useDocumentPreview } from "../../components/pages/licenses/useDocumentPreview.js";

describe("useDocumentPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("opens and revokes a license document preview URL", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      revokeObjectURL,
    });
    previewDocument.mockResolvedValueOnce({ data: { url: "blob:preview" }, error: null });

    const { result } = renderHook(() => useDocumentPreview({ showError: vi.fn() }));

    await act(async () => {
      await result.current.openDocumentPreview({
        id: 5,
        original_filename: "invoice.pdf",
        file_availability: "available",
      });
    });

    expect(previewDocument).toHaveBeenCalledWith(5);
    expect(result.current.documentPreview).toMatchObject({
      url: "blob:preview",
      loading: false,
    });

    act(() => {
      result.current.closeDocumentPreview();
    });

    expect(result.current.documentPreview).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  test("uses procurement preview and download endpoints for PO-scoped documents", async () => {
    previewProcurementDocument.mockResolvedValueOnce({ data: { url: "blob:po-preview" }, error: null });
    downloadProcurementDocument.mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(() => useDocumentPreview({ showError: vi.fn() }));
    const document = {
      id: 8,
      scope: "po",
      original_filename: "po.pdf",
      file_availability: "available",
    };

    await act(async () => {
      await result.current.openDocumentPreview(document);
      await result.current.downloadPreviewDocument(document);
    });

    expect(previewProcurementDocument).toHaveBeenCalledWith(8);
    expect(downloadProcurementDocument).toHaveBeenCalledWith(8, "po.pdf");
    expect(downloadDocument).not.toHaveBeenCalled();
  });
});

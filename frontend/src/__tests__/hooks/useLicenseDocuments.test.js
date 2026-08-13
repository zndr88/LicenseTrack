import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../api/documents.js", () => ({
  getDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  deleteProcurementDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadProcurementDocument: vi.fn(),
  invokeDocumentAction: vi.fn(),
  listDocumentActions: vi.fn().mockResolvedValue({ data: [], error: null }),
  listDocumentProcessingResults: vi.fn(),
  acceptDocumentProcessingResult: vi.fn(),
  rejectDocumentProcessingResult: vi.fn(),
}));

vi.mock("../../api/licenses.js", () => ({
  getLicense: vi.fn(),
}));

import {
  deleteDocument,
  getDocuments,
  listDocumentProcessingResults,
} from "../../api/documents.js";
import { getLicense } from "../../api/licenses.js";
import { useLicenseDocuments } from "../../hooks/useLicenseDocuments.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderForLicense(id) {
  return {
    license: {
      id,
      documents: {
        invoice: [],
        quote: [],
        purchase_order: [],
        eula: [],
        entitlement: [],
      },
    },
    onUpdate: vi.fn(),
    setConfirmAction: vi.fn(),
    setToast: vi.fn(),
  };
}

describe("useLicenseDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("ignores stale document and processing responses after license changes", async () => {
    const docs1 = deferred();
    const processing1 = deferred();
    const docs2 = deferred();
    const processing2 = deferred();

    getDocuments
      .mockReturnValueOnce(docs1.promise)
      .mockReturnValueOnce(docs2.promise);
    listDocumentProcessingResults
      .mockReturnValueOnce(processing1.promise)
      .mockReturnValueOnce(processing2.promise);

    const { result, rerender } = renderHook(
      (props) => useLicenseDocuments(props),
      { initialProps: renderForLicense(1) },
    );

    rerender(renderForLicense(2));

    await act(async () => {
      docs2.resolve({ data: [{ id: 20, category: "invoice", original_filename: "current.pdf" }], error: null });
      processing2.resolve({ data: [{ id: 21, status: "pending" }], error: null });
      await Promise.all([docs2.promise, processing2.promise]);
    });

    await waitFor(() => {
      expect(result.current.documents).toEqual([{ id: 20, category: "invoice", original_filename: "current.pdf" }]);
      expect(result.current.processingResults).toEqual([{ id: 21, status: "pending" }]);
    });

    await act(async () => {
      docs1.resolve({ data: [{ id: 10, category: "invoice", original_filename: "stale.pdf" }], error: null });
      processing1.resolve({ data: [{ id: 11, status: "pending" }], error: null });
      await Promise.all([docs1.promise, processing1.promise]);
    });

    expect(result.current.documents).toEqual([{ id: 20, category: "invoice", original_filename: "current.pdf" }]);
    expect(result.current.processingResults).toEqual([{ id: 21, status: "pending" }]);
  });

  test("ignores stale document refreshes after a delete finishes on a previous license", async () => {
    const initialDocs1 = deferred();
    const initialProcessing1 = deferred();
    const refreshDocs1 = deferred();
    const refreshLicense1 = deferred();
    const refreshProcessing1 = deferred();
    const docs2 = deferred();
    const processing2 = deferred();
    const onUpdate = vi.fn();
    const setConfirmAction = vi.fn();

    getDocuments
      .mockReturnValueOnce(initialDocs1.promise)
      .mockReturnValueOnce(refreshDocs1.promise)
      .mockReturnValueOnce(docs2.promise);
    listDocumentProcessingResults
      .mockReturnValueOnce(initialProcessing1.promise)
      .mockReturnValueOnce(processing2.promise)
      .mockReturnValueOnce(refreshProcessing1.promise);
    deleteDocument.mockResolvedValueOnce({ error: null });
    getLicense.mockReturnValueOnce(refreshLicense1.promise);

    const { result, rerender } = renderHook(
      (props) => useLicenseDocuments(props),
      { initialProps: { ...renderForLicense(1), onUpdate, setConfirmAction } },
    );

    await act(async () => {
      initialDocs1.resolve({ data: [{ id: 10, category: "invoice", original_filename: "stale.pdf" }], error: null });
      initialProcessing1.resolve({ data: [], error: null });
      await Promise.all([initialDocs1.promise, initialProcessing1.promise]);
    });

    await waitFor(() => {
      expect(result.current.documents).toEqual([{ id: 10, category: "invoice", original_filename: "stale.pdf" }]);
    });

    act(() => {
      result.current.handleFileRemove({ id: 10, original_filename: "stale.pdf" });
    });

    let confirmPromise;
    await act(async () => {
      confirmPromise = setConfirmAction.mock.calls[0][0].onConfirm();
      await Promise.resolve();
    });

    rerender({ ...renderForLicense(2), onUpdate, setConfirmAction });

    await act(async () => {
      docs2.resolve({ data: [{ id: 20, category: "invoice", original_filename: "current.pdf" }], error: null });
      processing2.resolve({ data: [], error: null });
      await Promise.all([docs2.promise, processing2.promise]);
    });

    await waitFor(() => {
      expect(result.current.documents).toEqual([{ id: 20, category: "invoice", original_filename: "current.pdf" }]);
    });

    await act(async () => {
      refreshDocs1.resolve({ data: [{ id: 11, category: "invoice", original_filename: "old-refresh.pdf" }], error: null });
      refreshLicense1.resolve({ data: { completenessPct: 100 }, error: null });
      await Promise.all([refreshDocs1.promise, refreshLicense1.promise, confirmPromise]);
    });

    expect(result.current.documents).toEqual([{ id: 20, category: "invoice", original_filename: "current.pdf" }]);
    expect(onUpdate).not.toHaveBeenCalledWith(1, expect.any(Object));
  });

  test("forwards available PDF preview requests to the page owner", async () => {
    const onPreviewDocument = vi.fn();
    getDocuments.mockResolvedValueOnce({ data: [], error: null });
    listDocumentProcessingResults.mockResolvedValueOnce({ data: [], error: null });

    const { result } = renderHook(
      (props) => useLicenseDocuments(props),
      { initialProps: { ...renderForLicense(1), onPreviewDocument } },
    );

    const document = {
      id: 5,
      category: "invoice",
      original_filename: "invoice.pdf",
      file_availability: "available",
    };
    await act(async () => {
      await result.current.handleFilePreview(document);
    });

    expect(onPreviewDocument).toHaveBeenCalledWith(document);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

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
  getDocuments,
  listDocumentProcessingResults,
} from "../../api/documents.js";
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
});

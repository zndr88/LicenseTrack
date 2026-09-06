import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { queryKeys } from "../../queryKeys.js";

vi.mock("../../api/licenses.js", () => ({
  getLicenses: vi.fn().mockResolvedValue({ data: [{ id: 1, licenseRef: "L-001" }], error: null }),
}));
vi.mock("../../api/pendingOrders.js", () => ({
  batchConvertPendingOrder: vi.fn(),
  convertPendingOrder: vi.fn(),
  createPendingOrder: vi.fn(),
  getPendingOrders: vi.fn().mockResolvedValue({ data: [], error: null }),
  uploadPendingOrderDocument: vi.fn(),
}));
vi.mock("../../api/documents.js", () => ({ uploadDocument: vi.fn() }));
vi.mock("../../api/sourcing.js", () => ({}));

import { usePendingOrdersData } from "../../components/pages/usePendingOrdersData.js";
import * as pendingOrdersApi from "../../api/pendingOrders.js";
import * as documentsApi from "../../api/documents.js";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(queryClient = makeQueryClient()) {
  return function wrapper({ children }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("usePendingOrdersData — licenses", () => {
  it("exposes licenses from the shared licenses query cache", async () => {
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.licenses).toHaveLength(1));
    expect(result.current.licenses[0].id).toBe(1);
  });

  it("exposes licenses when the shared cache still has the legacy array shape", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(queryKeys.licenses, [{ id: 7, licenseRef: "L-007" }]);

    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper: makeWrapper(queryClient) }
    );

    expect(result.current.licenses).toEqual([{ id: 7, licenseRef: "L-007" }]);
  });

  it("returns structured partial success when the order is created but its document upload fails", async () => {
    const showError = vi.fn();
    const onPortfolioStateChange = vi.fn();
    pendingOrdersApi.createPendingOrder.mockResolvedValueOnce({
      data: { id: 12, poNumber: "PO-12", items: [] },
      error: null,
    });
    pendingOrdersApi.uploadPendingOrderDocument.mockResolvedValueOnce({
      data: null,
      error: "storage unavailable",
    });
    const quoteFile = new File(["quote"], "quote.pdf", { type: "application/pdf" });
    const { result } = renderHook(
      () => usePendingOrdersData({
        showError,
        showSuccess: vi.fn(),
        onPortfolioStateChange,
      }),
      { wrapper: makeWrapper() }
    );

    let createResult;
    await act(async () => {
      createResult = await result.current.handleCreatePendingOrder({
        poNumber: "PO-12",
        supplier: "Acme",
        quoteFile,
        items: [{
          publisherName: " Acme ",
          softwareDescription: " Suite ",
          quantity: "2",
          currency: "EUR",
        }],
      });
    });

    expect(createResult).toEqual({
      ok: true,
      partial: true,
      data: { id: 12, poNumber: "PO-12", items: [] },
    });
    expect(pendingOrdersApi.createPendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      poNumber: "PO-12",
      items: [expect.objectContaining({ publisherName: "Acme", softwareDescription: "Suite" })],
    }));
    expect(pendingOrdersApi.uploadPendingOrderDocument).toHaveBeenCalledWith(12, quoteFile);
    expect(showError).toHaveBeenCalledWith(expect.stringMatching(/partial completion.*storage unavailable/i));
    expect(onPortfolioStateChange).toHaveBeenCalledTimes(1);
  });

  it("uploads a license-specific attachment to the converted license", async () => {
    const showSuccess = vi.fn();
    pendingOrdersApi.convertPendingOrder.mockResolvedValueOnce({
      data: [{ id: 44, conversionType: "new_purchase", sourceSourcingItemId: 11 }],
      error: null,
    });
    documentsApi.uploadDocument.mockResolvedValueOnce({ data: {}, error: null });
    const file = new File(["key"], "entitlement.txt", { type: "text/plain" });
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleConvertToLicense(9, { publisherName: "Acme" }, {
        file,
        category: "entitlement",
      });
    });

    expect(pendingOrdersApi.convertPendingOrder).toHaveBeenCalledWith(
      9,
      { publisherName: "Acme" },
      null,
    );
    expect(documentsApi.uploadDocument).toHaveBeenCalledWith(44, file, "entitlement", "license");
    expect(showSuccess).toHaveBeenCalled();
  });

  it("uses the selected converted line as the batch attachment target", async () => {
    pendingOrdersApi.batchConvertPendingOrder.mockResolvedValueOnce({
      data: [
        { id: 44, conversionType: "new_purchase", sourceSourcingItemId: 21 },
        { id: 45, conversionType: "renewed", sourceSourcingItemId: 22 },
      ],
      error: null,
    });
    documentsApi.uploadDocument.mockResolvedValueOnce({ data: {}, error: null });
    const file = new File(["terms"], "eula.txt", { type: "text/plain" });
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleBatchConvert(9, [{ sourcingItemId: 21 }, { sourcingItemId: 22 }], "PO-9", {
        file,
        category: "eula",
        targetSourcingItemId: 22,
      });
    });

    expect(pendingOrdersApi.batchConvertPendingOrder).toHaveBeenCalledWith(
      9,
      [{ sourcingItemId: 21 }, { sourcingItemId: 22 }],
      null,
    );
    expect(documentsApi.uploadDocument).toHaveBeenCalledWith(45, file, "eula", "license");
  });

  it("forwards the first invoice and uploads every remaining staged document", async () => {
    documentsApi.uploadDocument.mockClear();
    pendingOrdersApi.batchConvertPendingOrder.mockResolvedValueOnce({
      data: [
        { id: 44, conversionType: "new_purchase", sourceSourcingItemId: 21 },
        { id: 45, conversionType: "new_purchase", sourceSourcingItemId: 22 },
      ],
      error: null,
    });
    documentsApi.uploadDocument.mockResolvedValue({ data: {}, error: null });
    const firstInvoice = new File(["one"], "invoice-1.pdf", { type: "application/pdf" });
    const secondInvoice = new File(["two"], "invoice-2.pdf", { type: "application/pdf" });
    const entitlement = new File(["key"], "key.txt", { type: "text/plain" });
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleBatchConvert(9, [{ sourcingItemId: 21 }, { sourcingItemId: 22 }], "PO-9", [
        { id: "one", file: firstInvoice, category: "invoice" },
        { id: "two", file: secondInvoice, category: "invoice" },
        { id: "three", file: entitlement, category: "entitlement", targetSourcingItemId: 22 },
      ]);
    });

    expect(pendingOrdersApi.batchConvertPendingOrder).toHaveBeenCalledWith(
      9,
      [{ sourcingItemId: 21 }, { sourcingItemId: 22 }],
      firstInvoice,
    );
    expect(documentsApi.uploadDocument).toHaveBeenNthCalledWith(1, 44, secondInvoice, "invoice", "shared");
    expect(documentsApi.uploadDocument).toHaveBeenNthCalledWith(2, 45, entitlement, "entitlement", "license");
  });

  it("uploads a license-scoped invoice instead of forwarding it as shared evidence", async () => {
    pendingOrdersApi.convertPendingOrder.mockResolvedValueOnce({
      data: [{ id: 44, conversionType: "new_purchase", sourceSourcingItemId: 11 }],
      error: null,
    });
    documentsApi.uploadDocument.mockResolvedValueOnce({ data: {}, error: null });
    const invoice = new File(["invoice"], "line-invoice.pdf", { type: "application/pdf" });
    const { result } = renderHook(
      () => usePendingOrdersData({ showError: vi.fn(), showSuccess: vi.fn() }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleConvertToLicense(9, { publisherName: "Acme" }, {
        file: invoice,
        category: "invoice",
        scope: "license",
        targetSourcingItemId: 11,
      });
    });

    expect(pendingOrdersApi.convertPendingOrder).toHaveBeenCalledWith(
      9,
      { publisherName: "Acme" },
      null,
    );
    expect(documentsApi.uploadDocument).toHaveBeenCalledWith(
      44,
      invoice,
      "invoice",
      "license",
    );
  });
});

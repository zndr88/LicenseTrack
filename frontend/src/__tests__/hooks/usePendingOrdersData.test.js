import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { queryKeys } from "../../queryKeys.js";

vi.mock("../../api/licenses.js", () => ({
  getLicenses: vi.fn().mockResolvedValue({ data: [{ id: 1, licenseRef: "L-001" }], error: null }),
  getAllCustomFieldValues: vi.fn().mockResolvedValue({ data: { values: [] }, error: null }),
}));
vi.mock("../../api/pendingOrders.js", () => ({
  createPendingOrder: vi.fn(),
  getPendingOrders: vi.fn().mockResolvedValue({ data: [], error: null }),
  uploadPendingOrderDocument: vi.fn(),
}));
vi.mock("../../api/sourcing.js", () => ({}));

import { usePendingOrdersData } from "../../components/pages/usePendingOrdersData.js";
import * as pendingOrdersApi from "../../api/pendingOrders.js";

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
});

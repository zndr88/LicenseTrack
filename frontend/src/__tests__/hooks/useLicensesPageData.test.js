import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../queryKeys.js";

const apiMocks = vi.hoisted(() => ({
  getLicenses: vi.fn(),
  getStats: vi.fn(),
  getSourcingItems: vi.fn(),
  getPendingOrders: vi.fn(),
  getContracts: vi.fn(),
  listCustomFields: vi.fn(),
}));

vi.mock("../../api/licenses.js", () => ({
  getLicenses: apiMocks.getLicenses,
  getStats: apiMocks.getStats,
}));
vi.mock("../../api/sourcing.js", () => ({ getSourcingItems: apiMocks.getSourcingItems }));
vi.mock("../../api/pendingOrders.js", () => ({ getPendingOrders: apiMocks.getPendingOrders }));
vi.mock("../../api/contracts.js", () => ({ getContracts: apiMocks.getContracts }));
vi.mock("../../api/settings.js", () => ({ listCustomFields: apiMocks.listCustomFields }));

import {
  fetchLicensesData,
  useLicensesPageData,
} from "../../components/pages/licenses/useLicensesPageData.js";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(queryClient = makeQueryClient()) {
  return function wrapper({ children }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

beforeEach(() => {
  apiMocks.getLicenses.mockResolvedValue({ data: [], error: null });
  apiMocks.getStats.mockResolvedValue({ data: {}, error: null });
  apiMocks.getSourcingItems.mockResolvedValue({ data: [], error: null });
  apiMocks.getPendingOrders.mockResolvedValue({ data: [], error: null });
  apiMocks.getContracts.mockResolvedValue({ data: [], error: null });
  apiMocks.listCustomFields.mockResolvedValue({ data: [], error: null });
});

describe("useLicensesPageData", () => {
  it("builds the custom-field map from values embedded in the registry response", async () => {
    const customField = { id: 7, customFieldDefId: 3, valueText: "Finance" };
    apiMocks.getLicenses.mockResolvedValue({
      data: [{ id: 42, publisherName: "Acme", customFields: [customField] }],
      error: null,
    });

    const result = await fetchLicensesData();

    expect(result.licenses).toHaveLength(1);
    expect(result.customFieldValuesMap.get(42)).toEqual([customField]);
  });

  it("keeps an auxiliary failure separate from the core license query", async () => {
    apiMocks.getLicenses.mockResolvedValue({
      data: [{ id: 1, publisherName: "Acme", softwareDescription: "Suite" }],
      error: null,
    });
    apiMocks.getStats.mockResolvedValue({ data: null, error: "Stats unavailable" });

    const { result } = renderHook(
      () => useLicensesPageData({ showError: vi.fn() }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.licenses).toHaveLength(1));
    await waitFor(() => expect(result.current.auxiliaryIssues).toHaveLength(1));
    expect(result.current.licensesError).toBeNull();
    expect(result.current.auxiliaryIssues[0]).toMatchObject({
      key: "stats",
      label: "portfolio statistics",
      message: "Stats unavailable",
    });
  });

  it("retains the last successful auxiliary data when a refresh fails", async () => {
    const queryClient = makeQueryClient();
    apiMocks.getStats.mockResolvedValueOnce({ data: { total: 12 }, error: null });
    const { result } = renderHook(
      () => useLicensesPageData({ showError: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.apiStats).toEqual({ total: 12 }));

    apiMocks.getStats.mockResolvedValue({ data: null, error: "Refresh failed" });
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats }));

    await waitFor(() => expect(result.current.auxiliaryIssues).toHaveLength(1));
    expect(result.current.apiStats).toEqual({ total: 12 });
    expect(result.current.auxiliaryIssues[0].hasRetainedData).toBe(true);
  });

  it("marks pipeline totals unavailable instead of presenting an initial failure as zero", async () => {
    apiMocks.getSourcingItems.mockResolvedValue({ data: null, error: "Sourcing unavailable" });
    apiMocks.getPendingOrders.mockResolvedValue({ data: null, error: "Orders unavailable" });

    const { result } = renderHook(
      () => useLicensesPageData({ showError: vi.fn() }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.auxiliaryIssues).toHaveLength(2));
    expect(result.current.sourcingTotalsUnavailable).toBe(true);
    expect(result.current.pendingOrderTotalsUnavailable).toBe(true);
  });
});

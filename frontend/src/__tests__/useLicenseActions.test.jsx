import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useLicenseActions } from "../components/pages/licenses/useLicenseActions.js";
import { queryKeys } from "../queryKeys.js";
import * as licensesApi from "../api/licenses.js";
vi.mock("../api/licenses.js", () => ({
  bulkDeleteLicenses: vi.fn(),
  cancelRenewal: vi.fn(),
  deleteLicense: vi.fn(),
  getLicense: vi.fn(),
  initiateRenewal: vi.fn(),
  initiateRenewalBundle: vi.fn(),
  unlinkExistingSuccessor: vi.fn(),
  updateLicense: vi.fn(),
  patchLicenseField: vi.fn(),
}));

const baseLicense = {
  id: 1,
  publisherName: "Acme",
  softwareDescription: "Acme Suite",
  startDate: "",
  endDate: "",
  isRetired: false,
  documentCount: 0,
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderActions({
  licenses = [baseLicense],
  licenseCacheData,
  selectedId = null,
  selectedIds = new Set(),
  setSelectedId = vi.fn(),
  setSelectedIds = vi.fn(),
  setShowBulkDeleteConfirm = vi.fn(),
  showError = vi.fn(),
  showToast = vi.fn(),
  onPortfolioStateChange = vi.fn(),
  onSourcingCreated = vi.fn(),
  onNavigateToSourcing = vi.fn(),
} = {}) {
  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    queryKeys.licenses,
    licenseCacheData ?? { licenses, customFieldValuesMap: new Map() },
  );

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const rendered = renderHook(() => useLicenseActions({
    selectedId,
    selectedIds,
    setSelectedId,
    setSelectedIds,
    setShowBulkDeleteConfirm,
    showError,
    showToast,
    onPortfolioStateChange,
    onSourcingCreated,
    onNavigateToSourcing,
  }), { wrapper });

  return { ...rendered, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  licensesApi.updateLicense.mockResolvedValue({ data: {}, error: null });
  licensesApi.getLicense.mockResolvedValue({ data: baseLicense, error: null });
  licensesApi.bulkDeleteLicenses.mockResolvedValue({ data: {}, error: null });
  licensesApi.unlinkExistingSuccessor.mockResolvedValue({ data: null, error: null });
});

describe("useLicenseActions", () => {
  test.each(["update", "patch", "refresh"])("warns after a PO change with documents through %s", async (mode) => {
    licensesApi.patchLicenseField.mockResolvedValue({ data: { ...baseLicense, poNumber: "NEW" }, error: null });
    const { result } = renderActions({ licenses: [{ ...baseLicense, poNumber: "OLD", documentCount: 2 }] });
    await act(async () => {
      if (mode === "patch") await result.current.handleLicenseFieldPatch(1, "poNumber", "NEW");
      else await result.current.handleLicenseUpdate(1, { poNumber: "NEW", ...(mode === "refresh" ? { documentCount: 2 } : {}) });
    });
    expect(result.current.poDocumentWarning).toEqual({ oldPoNumber: "OLD", newPoNumber: "NEW" });
    act(() => result.current.dismissPoDocumentWarning());
    expect(result.current.poDocumentWarning).toBeNull();
  });

  test.each([
    ["unchanged PO", { poNumber: "OLD", documentCount: 2 }, { poNumber: "OLD" }],
    ["no documents", { poNumber: "OLD", documentCount: 0 }, { poNumber: "NEW" }],
    ["other field", { poNumber: "OLD", documentCount: 2 }, { softwareDescription: "Changed" }],
  ])("does not warn for %s", async (_label, license, updates) => {
    const { result } = renderActions({ licenses: [{ ...baseLicense, ...license }] });
    await act(async () => { await result.current.handleLicenseUpdate(1, updates); });
    expect(result.current.poDocumentWarning).toBeNull();
  });

  test("failed PO changes do not show the document warning", async () => {
    licensesApi.updateLicense.mockResolvedValueOnce({ error: "Save failed" });
    const { result } = renderActions({ licenses: [{ ...baseLicense, poNumber: "OLD", documentCount: 2 }] });
    await act(async () => { await result.current.handleLicenseUpdate(1, { poNumber: "NEW" }); });
    expect(result.current.poDocumentWarning).toBeNull();
  });

  test("preserves update payload shape while mapping retired to isRetired", async () => {
    const fresh = { ...baseLicense, isRetired: true, softwareDescription: "Updated Suite" };
    licensesApi.getLicense.mockResolvedValueOnce({ data: fresh, error: null });
    const { result, queryClient } = renderActions();

    await act(async () => {
      const ok = await result.current.handleLicenseUpdate(1, {
        retired: true,
        softwareDescription: "Updated Suite",
      });
      expect(ok).toBe(true);
    });

    expect(licensesApi.updateLicense).toHaveBeenCalledWith(1, {
      isRetired: true,
      softwareDescription: "Updated Suite",
    });
    const cached = queryClient.getQueryData(queryKeys.licenses);
    expect(cached.licenses[0]).toMatchObject({
      id: 1,
      retired: true,
      softwareDescription: "Updated Suite",
    });
  });

  test("keeps local document updates out of the license update API", async () => {
    const { result, queryClient } = renderActions();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      const ok = await result.current.handleLicenseUpdate(1, { documentCount: 2 });
      expect(ok).toBe(true);
    });

    expect(licensesApi.updateLicense).not.toHaveBeenCalled();
    expect(licensesApi.getLicense).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.licenses });
    const cached = queryClient.getQueryData(queryKeys.licenses);
    expect(cached.licenses[0].documentCount).toBe(2);
  });

  test("updates the shared licenses cache when it still has the legacy array shape", async () => {
    const { result, queryClient } = renderActions({
      licenseCacheData: [baseLicense],
    });

    await act(async () => {
      const ok = await result.current.handleLicenseUpdate(1, { documentCount: 3 });
      expect(ok).toBe(true);
    });

    const cached = queryClient.getQueryData(queryKeys.licenses);
    expect(cached).toEqual([{ ...baseLicense, documentCount: 3 }]);
  });

  test("bulk delete sends selected ids and clears selection/detail state", async () => {
    const setSelectedId = vi.fn();
    const setSelectedIds = vi.fn();
    const setShowBulkDeleteConfirm = vi.fn();
    const { result, queryClient } = renderActions({
      licenses: [baseLicense, { ...baseLicense, id: 2, softwareDescription: "Beta Suite" }],
      selectedId: 2,
      selectedIds: new Set([1, 2]),
      setSelectedId,
      setSelectedIds,
      setShowBulkDeleteConfirm,
    });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    expect(setShowBulkDeleteConfirm).toHaveBeenCalledWith(false);
    expect(licensesApi.bulkDeleteLicenses).toHaveBeenCalledWith([1, 2]);
    expect(setSelectedIds).toHaveBeenCalledWith(new Set());
    expect(setSelectedId).toHaveBeenCalledWith(null);
    const cached = queryClient.getQueryData(queryKeys.licenses);
    expect(cached.licenses).toEqual([]);
  });
});

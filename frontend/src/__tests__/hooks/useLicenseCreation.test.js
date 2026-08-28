import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createLicenseBatch } from "../../api/licenses.js";
import { uploadDocument } from "../../api/documents.js";
import { useLicenseCreation } from "../../hooks/useLicenseCreation.js";
import { queryKeys } from "../../queryKeys.js";

vi.mock("../../api/licenses.js", () => ({
  createLicenseBatch: vi.fn(),
}));

vi.mock("../../api/documents.js", () => ({
  uploadDocument: vi.fn(),
}));

function renderCreation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setConfirmData = vi.fn();
  const setPage = vi.fn();
  const setSelectedId = vi.fn();
  const showError = vi.fn();
  const wrapper = ({ children }) => React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children
  );
  const rendered = renderHook(() => useLicenseCreation({
    setConfirmData,
    setPage,
    setSelectedId,
    showError,
  }), { wrapper });

  return {
    ...rendered,
    queryClient,
    setConfirmData,
    setPage,
    setSelectedId,
    showError,
  };
}

function makeForm(overrides = {}) {
  return {
    publisherName: "Acme",
    softwareDescription: "Suite",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    noticeDate: "2026-10-01",
    contractNumber: "C-1",
    poNumber: "PO-1",
    invoiceNumber: "INV-1",
    contactEmail: "owner@example.com",
    supplier: "Supplier",
    costCentre: "IT",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    skuCode: "SKU-1",
    unitPrice: "12.50",
    totalPoPrice: "125.00",
    currency: "EUR",
    notes: "Notes",
    budgetOwnerEmail: "budget@example.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createLicenseBatch.mockResolvedValue({ data: [{ id: 41 }], error: null });
  uploadDocument.mockResolvedValue({ data: {}, error: null });
});

describe("useLicenseCreation", () => {
  test("submits one atomic ordered batch with parent-line references", async () => {
    const { result } = renderCreation();
    const forms = [
      makeForm({ parentLicenseId: 99, maintenanceParentIds: [12] }),
      makeForm({
        publisherName: "Acme Maintenance",
        licenseType: "maintenance",
        parentLicenseId: 99,
        parentLineIndex: 0,
      }),
    ];

    await act(async () => {
      await result.current(forms);
    });

    expect(createLicenseBatch).toHaveBeenCalledTimes(1);
    expect(createLicenseBatch).toHaveBeenCalledWith([
      {
        license: expect.objectContaining({
          publisherName: "Acme",
          parentLicenseId: 99,
          maintenanceParentIds: [12],
          portalUrl: null,
          isRetired: false,
        }),
      },
      {
        license: expect.not.objectContaining({ parentLicenseId: expect.anything() }),
        parentLineIndex: 0,
      },
    ]);
  });

  test("stops without navigation or invalidation when batch creation fails", async () => {
    createLicenseBatch.mockResolvedValueOnce({ data: null, error: "Batch failed" });
    const { result, queryClient, setConfirmData, setPage, showError } = renderCreation();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    let succeeded;
    await act(async () => {
      succeeded = await result.current(makeForm());
    });

    expect(succeeded).toBe(false);
    expect(showError).toHaveBeenCalledWith("Batch failed");
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(setConfirmData).not.toHaveBeenCalled();
    expect(setPage).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  test("keeps created licenses and selects the first when attachment upload fails", async () => {
    createLicenseBatch.mockResolvedValueOnce({ data: [{ id: 41 }, { id: 42 }], error: null });
    uploadDocument.mockResolvedValueOnce({ data: null, error: "Storage unavailable" });
    const {
      result,
      queryClient,
      setConfirmData,
      setPage,
      setSelectedId,
      showError,
    } = renderCreation();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const file = new File(["invoice"], "invoice.pdf", { type: "application/pdf" });

    let succeeded;
    await act(async () => {
      succeeded = await result.current([makeForm(), makeForm()], file, "invoice");
    });

    expect(succeeded).toBe(true);
    expect(uploadDocument).toHaveBeenCalledWith(41, file, "invoice");
    expect(setSelectedId).toHaveBeenCalledWith(41);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining(
      "Licenses saved, but document upload failed: Storage unavailable."
    ));
    expect(setConfirmData).toHaveBeenCalledWith(null);
    expect(setPage).toHaveBeenCalledWith("licenses");
    expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
      queryKeys.licenses,
      queryKeys.portfolioStats,
      queryKeys.reportsPortfolioStats,
      queryKeys.reportsDetailed,
      queryKeys.notifications,
    ]);
  });
});

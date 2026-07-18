import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  updateLicensesQueryCache,
  useRenewalWorkflowActions,
} from "../hooks/useRenewalWorkflowActions.js";
import { queryKeys } from "../queryKeys.js";
import * as licensesApi from "../api/licenses.js";

vi.mock("../api/licenses.js", () => ({
  cancelRenewal: vi.fn(),
  initiateRenewal: vi.fn(),
  initiateRenewalBundle: vi.fn(),
}));

const license = {
  id: 1,
  publisherName: "Acme",
  softwareDescription: "Acme Suite",
  documentCount: 0,
};

const renewalResponse = {
  license: { ...license, lifecycleStatus: "pending_renewal" },
  sourcingItem: { id: 7, renewalForLicenseId: 1 },
};

const bundleResponse = {
  licenses: [
    { ...license, lifecycleStatus: "pending_renewal" },
    { ...license, id: 2, lifecycleStatus: "pending_renewal" },
  ],
  sourcingRequest: {
    id: 20,
    items: [
      { id: 7, renewalForLicenseId: 1 },
      { id: 8, renewalForLicenseId: 2 },
    ],
  },
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderRenewalActions(props = {}) {
  const queryClient = makeQueryClient();
  queryClient.setQueryData(queryKeys.licenses, { licenses: [license] });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const rendered = renderHook(() => useRenewalWorkflowActions(props), { wrapper });
  return { ...rendered, invalidateSpy, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  licensesApi.initiateRenewal.mockResolvedValue({ data: renewalResponse, error: null });
  licensesApi.initiateRenewalBundle.mockResolvedValue({ data: bundleResponse, error: null });
  licensesApi.cancelRenewal.mockResolvedValue({
    data: { license, poWarning: false },
    error: null,
  });
});

describe("useRenewalWorkflowActions", () => {
  test("updates the shared licenses cache when it still has the legacy array shape", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(queryKeys.licenses, [license]);

    updateLicensesQueryCache(queryClient, (licenses) => licenses.map((item) => (
      item.id === license.id ? { ...item, lifecycleStatus: "pending_renewal" } : item
    )));

    expect(queryClient.getQueryData(queryKeys.licenses)).toEqual([
      { ...license, lifecycleStatus: "pending_renewal" },
    ]);
  });

  test("starts renewal, updates local caches, and invalidates workflow queries", async () => {
    const onSourcingCreated = vi.fn();
    const onRenewalStarted = vi.fn();
    const { result, queryClient, invalidateSpy } = renderRenewalActions({
      onSourcingCreated,
      onRenewalStarted,
    });

    await act(async () => {
      const outcome = await result.current.startRenewal(1);
      expect(outcome.ok).toBe(true);
    });

    expect(licensesApi.initiateRenewal).toHaveBeenCalledWith(1);
    expect(onSourcingCreated).toHaveBeenCalledWith(renewalResponse.sourcingItem);
    expect(onRenewalStarted).toHaveBeenCalledWith(renewalResponse);
    expect(queryClient.getQueryData(queryKeys.licenses).licenses[0]).toMatchObject({
      id: 1,
      lifecycleStatus: "pending_renewal",
    });
    expect(queryClient.getQueryData(queryKeys.sourcingItems)).toEqual([renewalResponse.sourcingItem]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.licenseStats });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.renewals });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notifications });
  });

  test("starts a renewal bundle and stores all returned sourcing lines", async () => {
    const { result, queryClient } = renderRenewalActions({
      onSourcingCreated: vi.fn(),
      onRenewalStarted: vi.fn(),
    });
    queryClient.setQueryData(queryKeys.licenses, {
      licenses: [license, { ...license, id: 2 }],
    });

    await act(async () => {
      const outcome = await result.current.startRenewalBundle([1, 2]);
      expect(outcome.ok).toBe(true);
    });

    expect(licensesApi.initiateRenewalBundle).toHaveBeenCalledWith([1, 2]);
    expect(queryClient.getQueryData(queryKeys.licenses).licenses).toEqual([
      expect.objectContaining({ id: 1, lifecycleStatus: "pending_renewal" }),
      expect.objectContaining({ id: 2, lifecycleStatus: "pending_renewal" }),
    ]);
    expect(queryClient.getQueryData(queryKeys.sourcingItems)).toEqual(bundleResponse.sourcingRequest.items);
  });

  test("cancels renewal and reports pending-order cleanup warnings", async () => {
    const showError = vi.fn();
    licensesApi.cancelRenewal.mockResolvedValueOnce({
      data: { license, poWarning: true },
      error: null,
    });
    const { result } = renderRenewalActions({ showError });

    await act(async () => {
      const outcome = await result.current.cancelRenewal(1);
      expect(outcome.ok).toBe(true);
    });

    expect(licensesApi.cancelRenewal).toHaveBeenCalledWith(1);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("pending order already existed"));
  });
});

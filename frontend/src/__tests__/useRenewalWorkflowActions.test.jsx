import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useRenewalWorkflowActions } from "../hooks/useRenewalWorkflowActions.js";
import { queryKeys } from "../queryKeys.js";
import * as licensesApi from "../api/licenses.js";

vi.mock("../api/licenses.js", () => ({
  cancelRenewal: vi.fn(),
  initiateRenewal: vi.fn(),
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
  licensesApi.cancelRenewal.mockResolvedValue({
    data: { license, po_warning: false },
    error: null,
  });
});

describe("useRenewalWorkflowActions", () => {
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

  test("cancels renewal and reports pending-order cleanup warnings", async () => {
    const showError = vi.fn();
    licensesApi.cancelRenewal.mockResolvedValueOnce({
      data: { license, po_warning: true },
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

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import * as pendingOrdersApi from "../api/pendingOrders.js";
import * as licensesApi from "../api/licenses.js";
import { demoRequest } from "../demo/router.js";
import { resetStore } from "../demo/store.js";
import {
  fetchLicenseStats,
  fetchPendingOrders,
  fetchPendingOrdersWithEvidenceIssues,
} from "../queryFns.js";
import { invalidatePendingOrders } from "../queryInvalidation.js";
import { queryKeys } from "../queryKeys.js";

describe("pending-order list queries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("the open list and the wider list are cached under different keys", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.pendingOrders, [{ id: 1, status: "pending" }]);
    queryClient.setQueryData(queryKeys.pendingOrdersWithEvidenceIssues, [
      { id: 1, status: "pending" },
      { id: 2, status: "converted" },
    ]);

    expect(queryClient.getQueryData(queryKeys.pendingOrders)).toHaveLength(1);
    expect(queryClient.getQueryData(queryKeys.pendingOrdersWithEvidenceIssues)).toHaveLength(2);
  });

  test("each key's fetch function asks the API for its own list", async () => {
    const getPendingOrders = vi.spyOn(pendingOrdersApi, "getPendingOrders")
      .mockResolvedValue({ data: [{ id: 1 }], error: null });

    await expect(fetchPendingOrders()).resolves.toEqual([{ id: 1 }]);
    expect(getPendingOrders).toHaveBeenLastCalledWith();

    await expect(fetchPendingOrdersWithEvidenceIssues()).resolves.toEqual([{ id: 1 }]);
    expect(getPendingOrders).toHaveBeenLastCalledWith({ includeEvidenceIssues: true });

    getPendingOrders.mockResolvedValue({ data: null, error: "List failed" });
    await expect(fetchPendingOrders()).rejects.toThrow("List failed");
    await expect(fetchPendingOrdersWithEvidenceIssues()).rejects.toThrow("List failed");
  });

  test("the shared license statistics fetch returns the data or throws the error", async () => {
    const getStats = vi.spyOn(licensesApi, "getStats").mockResolvedValue({ data: { total_active: 3 }, error: null });
    await expect(fetchLicenseStats()).resolves.toEqual({ total_active: 3 });

    getStats.mockResolvedValue({ data: null, error: "Stats failed" });
    await expect(fetchLicenseStats()).rejects.toThrow("Stats failed");
  });

  test("shared invalidation marks both lists as out of date", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.pendingOrders, []);
    queryClient.setQueryData(queryKeys.pendingOrdersWithEvidenceIssues, []);
    queryClient.setQueryData(queryKeys.pendingOrderHistory, []);

    await invalidatePendingOrders(queryClient);

    expect(queryClient.getQueryState(queryKeys.pendingOrders).isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.pendingOrdersWithEvidenceIssues).isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.pendingOrderHistory).isInvalidated).toBe(false);
  });

  test("demo mode serves both list variants", async () => {
    resetStore();
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const open = await demoRequest("/api/pending-orders", { method: "GET" });
    const wider = await demoRequest("/api/pending-orders?include_evidence_issues=true", { method: "GET" });

    expect(open.error).toBeNull();
    expect(wider.error).toBeNull();
    expect(open.data.length).toBeGreaterThan(0);
    // The demo has no document transfers, so the wider list adds no rows.
    expect(wider.data.map((order) => order.id)).toEqual(open.data.map((order) => order.id));
  });
});

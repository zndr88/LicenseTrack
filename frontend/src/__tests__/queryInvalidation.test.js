import { describe, expect, test, vi } from "vitest";

import {
  invalidateContracts,
  invalidateNotifications,
  invalidateRenewalWorkflow,
} from "../queryInvalidation.js";
import { queryKeys } from "../queryKeys.js";

function makeQueryClient() {
  return { invalidateQueries: vi.fn() };
}

describe("query invalidation helpers", () => {
  test("invalidates notifications by the shared query key", () => {
    const queryClient = makeQueryClient();

    invalidateNotifications(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.notifications });
  });

  test("invalidates every cache touched by renewal workflow mutations", () => {
    const queryClient = makeQueryClient();

    invalidateRenewalWorkflow(queryClient);

    expect(queryClient.invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
      queryKeys.licenses,
      queryKeys.sourcing,
      queryKeys.renewals,
      queryKeys.portfolioStats,
      queryKeys.reportsPortfolioStats,
      queryKeys.notifications,
    ]);
  });

  test("invalidates contracts by the shared query key", () => {
    const queryClient = makeQueryClient();

    invalidateContracts(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.contracts });
  });
});

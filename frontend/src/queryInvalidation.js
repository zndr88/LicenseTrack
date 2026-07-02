import { queryKeys } from "./queryKeys.js";

// Invalidate the notifications query.
// Used after any mutation that may generate or clear notification banners
// (license updates/deletes, imports, settings saves, PO conversions).
export function invalidateNotifications(queryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

// Invalidate all queries affected by a renewal workflow mutation.
// Covers licenses, sourcing, renewals, portfolio counts, and notifications.
export function invalidateRenewalWorkflow(queryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
  queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
  queryClient.invalidateQueries({ queryKey: queryKeys.renewals });
  queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

// Invalidate the contracts query.
// Used after creating a contract or closing the contract modal after edits.
export function invalidateContracts(queryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.contracts });
}

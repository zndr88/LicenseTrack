import { queryKeys } from "./queryKeys.js";

// Invalidate the notifications query.
// Used after any mutation that may generate or clear notification banners
// (license updates/deletes, imports, settings saves, PO conversions).
export function invalidateNotifications(queryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

// Invalidate all queries affected by a renewal workflow mutation.
// Covers licenses, sourcing views/items, renewals, portfolio counts, and notifications.
export function invalidateRenewalWorkflow(queryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
  queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
  queryClient.invalidateQueries({ queryKey: queryKeys.sourcingHistory });
  queryClient.invalidateQueries({ queryKey: queryKeys.sourcingItems });
  queryClient.invalidateQueries({ queryKey: queryKeys.renewals });
  queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

// Invalidate procurement caches that can indirectly change renewal lifecycle
// state, sidebar portfolio numbers, or pipeline counts.
export function invalidateProcurementRenewalState(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.licenses }),
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcing }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcingHistory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sourcingItems }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrderHistory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.renewals }),
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats }),
    queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats }),
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  ]);
}

// Invalidate queries whose computed completeness/notification data depends on
// global mandatory-field settings.
export function invalidateCompletenessRules(queryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
  queryClient.invalidateQueries({ queryKey: queryKeys.licenseStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
  queryClient.invalidateQueries({ queryKey: queryKeys.renewals });
  queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
}

// Invalidate queries affected by custom field definition changes.
// Covers reusable definitions plus license/workbench views that render custom
// field columns and sections from those definitions.
export function invalidateCustomFieldDefinitions(queryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.customFieldDefs });
  queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
  queryClient.invalidateQueries({ queryKey: queryKeys.renewals });
}

// Invalidate the contracts query.
// Used after creating a contract or closing the contract modal after edits.
export function invalidateContracts(queryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.contracts });
}

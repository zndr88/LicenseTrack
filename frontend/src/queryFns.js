import { getStats } from "./api/licenses.js";
import { getPendingOrders } from "./api/pendingOrders.js";

// Shared query functions for cache keys that more than one screen reads.
// Each key in queryKeys.js listed here has exactly one fetch function, so
// every reader of a key caches the same data shape.

// queryKeys.licenseStats
export async function fetchLicenseStats() {
  const { data, error } = await getStats();
  if (error) throw new Error(error);
  return data ?? null;
}

// queryKeys.pendingOrders: open pending orders only.
export async function fetchPendingOrders() {
  const { data, error } = await getPendingOrders();
  if (error) throw new Error(error);
  return data ?? [];
}

// queryKeys.pendingOrdersWithEvidenceIssues: open pending orders plus
// converted orders whose document transfer still needs attention.
export async function fetchPendingOrdersWithEvidenceIssues() {
  const { data, error } = await getPendingOrders({ includeEvidenceIssues: true });
  if (error) throw new Error(error);
  return data ?? [];
}

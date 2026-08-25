import { getExpirationStatus } from "./helpers.js";

export function getRenewalBundleMembers(license, candidates, notificationDays = 30) {
  if (!license?.poNumber || !license?.endDate || !license?.budgetOwnerEmail?.trim()) return [];

  return (candidates ?? []).filter((candidate) => {
    if (!candidate || candidate.id === license.id) return false;
    if (candidate.poNumber !== license.poNumber || candidate.endDate !== license.endDate) return false;
    if (!candidate.budgetOwnerEmail?.trim()) return false;
    if (candidate.renewedToId || candidate.retired || candidate.lifecycleStatus === "pending_renewal") return false;

    const expiration = getExpirationStatus(
      candidate.endDate,
      notificationDays,
      candidate.retired,
      candidate.lifecycleStatus,
      candidate.renewedToId,
      candidate.startDate,
      candidate.licenseType,
    );
    return expiration.status === "expiring" || expiration.status === "expired";
  });
}

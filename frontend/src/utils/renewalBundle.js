export function getRenewalBundleMembers(license, candidates) {
  if (!license?.poNumber || !license?.endDate || !license?.budgetOwnerEmail?.trim()) return [];

  return (candidates ?? []).filter((candidate) => {
    if (!candidate || candidate.id === license.id) return false;
    if (candidate.poNumber !== license.poNumber || candidate.endDate !== license.endDate) return false;
    if (!candidate.budgetOwnerEmail?.trim()) return false;
    if (candidate.renewedToId || candidate.retired || candidate.lifecycleStatus === "pending_renewal") return false;

    return candidate.expirationStatus === "expiring" || candidate.expirationStatus === "expired";
  });
}

export function getLicenseAttentionItems(licenses, dismissedIds) {
  return licenses
    .filter((license) => (
      license.renewedToId == null
      && !license.retirementScheduled
      && (license.expiration.status === "expiring" || license.expiration.status === "expired")
      && !dismissedIds.has(license.id)
    ))
    .sort((a, b) => (a.expiration.days ?? 0) - (b.expiration.days ?? 0));
}

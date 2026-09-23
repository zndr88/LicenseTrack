import { daysBetween, todayStr } from "./helpers.js";
import { isRenewableLicense } from "./licenseTypeRules.js";

export function getRenewalActionDays(globalSettings) {
  const configured = globalSettings?.renewalActionDays;
  if (configured !== null && configured !== undefined && Number.isFinite(Number(configured))) {
    return Number(configured);
  }
  return Number(globalSettings?.notificationDays ?? 30);
}

export function isRenewalActionEligible(license, actionDays, today = todayStr()) {
  if (!license?.endDate || !isRenewableLicense(license)) return false;
  if (license.renewedToId || license.retired || license.retirementScheduled) return false;
  if (["pending_renewal", "renewed", "legacy"].includes(license.lifecycleStatus)) return false;
  if (license.startDate && license.startDate > today) return false;

  const suppliedDays = license.daysUntilExpiry ?? license.expiration?.days;
  const daysUntilExpiry = suppliedDays === null || suppliedDays === undefined
    ? daysBetween(today, license.endDate)
    : Number(suppliedDays);
  return Number.isFinite(daysUntilExpiry) && daysUntilExpiry <= actionDays;
}

export function getRenewalBundleMembers(license, candidates, actionDays = 30, today = todayStr()) {
  if (!license?.poNumber || !license?.endDate || !license?.budgetOwnerEmail?.trim()) return [];

  return (candidates ?? []).filter((candidate) => {
    if (!candidate || candidate.id === license.id) return false;
    if (candidate.poNumber !== license.poNumber || candidate.endDate !== license.endDate) return false;
    if (!candidate.budgetOwnerEmail?.trim()) return false;
    return isRenewalActionEligible(candidate, actionDays, today);
  });
}

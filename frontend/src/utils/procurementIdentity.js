import { getLineAmount } from "./lineAmount.js";

export function normalizeProcurementPoNumber(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeProcurementCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function procurementIdentityKey(license) {
  const currency = normalizeProcurementCurrency(license?.currency);
  if (!currency) return null;
  if (license?.pendingOrderId != null) return [`pending-order:${license.pendingOrderId}`, currency];
  if (license?.procurementBundleId) return [`procurement-bundle:${license.procurementBundleId}`, currency];
  const poNumber = normalizeProcurementPoNumber(license?.poNumber);
  if (poNumber) return [`po:${poNumber}`, currency];
  if (license?.id != null) return [`unkeyed:${license.id}`, currency];
  return null;
}

export function hasSameProcurementIdentity(license, selected) {
  const identity = procurementIdentityKey(license);
  const selectedIdentity = procurementIdentityKey(selected);
  return identity !== null
    && selectedIdentity !== null
    && identity[0] === selectedIdentity[0]
    && identity[1] === selectedIdentity[1];
}

// The one owner of a purchase's figures: the sum of its non-retired lines
// (quantity x unit price) and the manual PO total, which replaces that sum
// once per purchase.
export function getProcurementBreakdown(selected, allLicenses) {
  if (procurementIdentityKey(selected) === null) return { lineSum: 0, override: null, total: 0 };
  const matching = (allLicenses ?? []).filter(
    (license) => hasSameProcurementIdentity(license, selected) && !license.retired,
  );
  const overrideLine = matching.find(
    (license) => license.poTotalOverride !== null
      && license.poTotalOverride !== undefined
      && license.poTotalOverride !== "",
  );
  const lineSum = matching.reduce((sum, license) => sum + (getLineAmount(license) ?? 0), 0);
  const override = overrideLine ? (Number(overrideLine.poTotalOverride) || 0) : null;
  return { lineSum, override, total: override ?? lineSum };
}

export function getProcurementTotal(selected, allLicenses) {
  return getProcurementBreakdown(selected, allLicenses).total;
}

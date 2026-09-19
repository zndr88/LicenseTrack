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

export function getProcurementTotal(selected, allLicenses) {
  const selectedIdentity = procurementIdentityKey(selected);
  if (selectedIdentity === null) return 0;
  const matching = (allLicenses ?? []).filter(
    (license) => hasSameProcurementIdentity(license, selected) && !license.retired,
  );
  const override = matching.find(
    (license) => license.poTotalOverride !== null
      && license.poTotalOverride !== undefined
      && license.poTotalOverride !== "",
  );
  if (override) return Number(override.poTotalOverride) || 0;
  return matching.reduce(
    (sum, license) => sum + (parseFloat(license.quantity) || 0) * (parseFloat(license.unitPrice) || 0),
    0,
  );
}

const BUNDLED_INCLUDED_SUPPORT_TYPES = new Set(["subscription", "saas"]);

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function parseNumber(value) {
  if (!hasValue(value)) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function defaultMaintenanceCoverage(licenseType) {
  if (licenseType === "subscription" || licenseType === "saas") return "included";
  if (licenseType === "maintenance" || licenseType === "service" || licenseType === "other") {
    return "not_applicable";
  }
  return "unknown";
}

export function isBundledIncludedSupport(licenseType, maintenanceCoverage) {
  return BUNDLED_INCLUDED_SUPPORT_TYPES.has(licenseType) && maintenanceCoverage === "included";
}

export function calculateAcquisitionTotal(data) {
  const total = parseNumber(data.totalPoPrice ?? data.estimatedTotalPrice);
  if (total !== null) return formatMoney(total);

  const quantity = parseNumber(data.quantity);
  const unitPrice = parseNumber(data.unitPrice ?? data.estimatedUnitPrice);
  if (quantity === null || unitPrice === null) return null;
  return formatMoney(quantity * unitPrice);
}

export function applyBundledIncludedSupportDefaults(data) {
  if (!isBundledIncludedSupport(data.licenseType, data.maintenanceCoverage)) return data;

  data.maintenanceStartDate = data.startDate ?? null;
  data.maintenanceEndDate = data.endDate ?? null;
  data.maintenancePricingBasis = "flat";
  data.maintenanceQuantity = null;
  data.maintenanceUnitPrice = null;

  const acquisitionTotal = calculateAcquisitionTotal(data);
  if (acquisitionTotal !== null) {
    data.maintenanceCost = acquisitionTotal;
  }

  return data;
}

/**
 * Mirrors backend/app/services/procurement_totals.py apply_included_support_defaults:
 * per-unit included support derives its cost from quantity x unit price, the
 * "free" basis (no charge) stores a zero cost, and bundled subscription/SaaS
 * support is re-derived from the license term.
 */
export function applyIncludedSupportDefaults(data) {
  if (data.maintenanceCoverage === "included" && data.maintenancePricingBasis === "per_unit") {
    const quantity = parseNumber(data.maintenanceQuantity);
    const unitPrice = parseNumber(data.maintenanceUnitPrice);
    data.maintenanceCost = quantity === null || unitPrice === null ? null : formatMoney(quantity * unitPrice);
  }
  if (data.maintenanceCoverage === "included" && data.maintenancePricingBasis === "free") {
    data.maintenanceQuantity = null;
    data.maintenanceUnitPrice = null;
    data.maintenanceCost = "0";
  }
  return applyBundledIncludedSupportDefaults(data);
}

export function withDefaultMaintenanceCoverage(data) {
  data.maintenanceCoverage = data.maintenanceCoverage || defaultMaintenanceCoverage(data.licenseType);
  return applyIncludedSupportDefaults(data);
}

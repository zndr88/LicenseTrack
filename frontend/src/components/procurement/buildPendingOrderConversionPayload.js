import { parseLocalizedNumber } from "../../utils/formatting.js";

function normalizeDate(dateValue) {
  if (!dateValue) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
  const parts = dateValue.split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return null;
}

function canonicalizeNumber(value, settings) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return parseLocalizedNumber(raw, settings) ?? raw;
}

function parseOptionalInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPendingOrderConversionPayload(data, settings) {
  return {
    publisherName:       data.publisherName.trim(),
    softwareDescription: data.softwareDescription.trim(),
    startDate:           normalizeDate(data.startDate),
    endDate:             data.isPerpetual ? null : normalizeDate(data.endDate),
    contractNumber:      data.contractNumber,
    poNumber:            data.poNumber,
    invoiceNumber:       data.invoiceNumber,
    contactEmail:        data.contactEmail,
    supplier:            data.supplier,
    costCentre:          data.costCentre,
    licenseType:         data.licenseType  || "subscription",
    licenseMetric:       data.licenseMetric || "per_user",
    portalUrl:           data.licenseType === "saas" ? (data.portalUrl || null) : null,
    ...(data.licenseType === "maintenance" ? { parentLicenseId: parseOptionalInt(data.parentLicenseId) } : {}),
    quantity:            canonicalizeNumber(data.quantity, settings),
    skuCode:             data.skuCode,
    unitPrice:           canonicalizeNumber(data.unitPrice, settings),
    totalPoPrice:        canonicalizeNumber(data.totalPoPrice, settings),
    currency:            data.currency,
    budgetOwnerEmail:    data.budgetOwnerEmail,
    notes:               data.notes || null,
  };
}

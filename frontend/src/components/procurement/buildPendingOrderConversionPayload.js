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
    noticeDate:          normalizeDate(data.noticeDate),
    purchaseDate:        normalizeDate(data.purchaseDate),
    contractNumber:      data.contractNumber,
    poNumber:            data.poNumber,
    procurementReference: data.procurementReference,
    invoiceNumber:       data.invoiceNumber,
    externalRef:         data.externalRef || null,
    contactEmail:        data.contactEmail,
    supplier:            data.supplier,
    costCentre:          data.costCentre,
    licenseType:         data.licenseType  || "subscription",
    licenseMetric:       data.licenseMetric || "per_user",
    portalUrl:           data.licenseType === "saas" ? (data.portalUrl || null) : null,
    ...(data.licenseType === "maintenance" ? { parentLicenseId: parseOptionalInt(data.parentLicenseId) } : {}),
    maintenanceCoverage: data.maintenanceCoverage || "unknown",
    maintenanceStartDate: normalizeDate(data.maintenanceStartDate),
    maintenanceEndDate: normalizeDate(data.maintenanceEndDate),
    maintenancePricingBasis: data.maintenancePricingBasis || null,
    maintenanceQuantity: canonicalizeNumber(data.maintenanceQuantity, settings),
    maintenanceUnitPrice: canonicalizeNumber(data.maintenanceUnitPrice, settings),
    maintenanceCost: canonicalizeNumber(data.maintenanceCost, settings),
    quantity:            canonicalizeNumber(data.quantity, settings),
    quantityPerUnit:     canonicalizeNumber(data.quantityPerUnit, settings) || "1",
    skuCode:             data.skuCode,
    unitPrice:           data.licenseType === "freeware" ? null : canonicalizeNumber(data.unitPrice, settings),
    totalPoPrice:        data.licenseType === "freeware" ? null : canonicalizeNumber(data.totalPoPrice, settings),
    currency:            data.currency,
    budgetOwnerEmail:    data.budgetOwnerEmail,
    secondaryContacts:   String(data.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
    customFieldValues:   data.customFieldValuesPayload || [],
    notes:               data.notes || null,
  };
}

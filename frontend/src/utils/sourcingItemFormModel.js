import { buildCustomFieldValuePayload, customFieldValueMap } from "./customFieldFormValues.js";
import { parseLocalizedNumber } from "./formatting.js";
import { defaultMaintenanceCoverageForLicenseType, supportsMaintenanceCoverage } from "./maintenanceCoverage.js";
import { formatSecondaryContacts, parseSecondaryContacts } from "./secondaryContacts.js";

function normalizeOptionalNumber(value, settings) {
  return (parseLocalizedNumber(value, settings) ?? value) || null;
}

export function getSourcingItemInitialTotal(item) {
  if (!item) return "";
  const quantity = parseFloat(item.quantity ?? "");
  const unitPrice = parseFloat(item.estimatedUnitPrice ?? "");
  if (!Number.isNaN(quantity) && !Number.isNaN(unitPrice) && quantity > 0 && unitPrice > 0) {
    return (quantity * unitPrice).toFixed(2);
  }
  return item.estimatedTotalPrice ?? "";
}

export function sourcingItemToFormDefaults(item, sourcingRequest) {
  const isRenewal = Boolean(item?.isRenewal || item?.renewalForLicenseId != null);

  return {
    publisherName: item?.publisherName ?? "",
    softwareDescription: item?.softwareDescription ?? "",
    licenseType: item?.licenseType ?? "",
    licenseMetric: item?.licenseMetric ?? "per_user",
    portalUrl: item?.portalUrl ?? "",
    maintenanceCoverage: item?.maintenanceCoverage
      ?? (isRenewal ? defaultMaintenanceCoverageForLicenseType(item?.licenseType) : "unknown"),
    maintenanceStartDate: item?.maintenanceStartDate ?? "",
    maintenanceEndDate: item?.maintenanceEndDate ?? "",
    maintenancePricingBasis: item?.maintenancePricingBasis ?? "flat",
    maintenanceQuantity: item?.maintenanceQuantity ?? "",
    maintenanceUnitPrice: item?.maintenanceUnitPrice ?? "",
    maintenanceCost: item?.maintenanceCost ?? "",
    quantity: item?.quantity ?? "",
    quantityPerUnit: item?.quantityPerUnit ?? "1",
    skuCode: item?.skuCode ?? "",
    estimatedUnitPrice: item?.estimatedUnitPrice ?? "",
    estimatedTotalPrice: getSourcingItemInitialTotal(item),
    currency: item?.currency ?? "EUR",
    startDate: item?.startDate ?? "",
    endDate: item?.endDate ?? "",
    noticeDate: item?.noticeDate ?? "",
    purchaseDate: item?.purchaseDate ?? "",
    contractNumber: item?.contractNumber ?? "",
    invoiceNumber: item?.invoiceNumber ?? "",
    externalRef: item?.externalRef ?? "",
    costCentre: item?.costCentre ?? "",
    budgetOwnerEmail: item?.budgetOwnerEmail ?? "",
    secondaryContacts: formatSecondaryContacts(item?.secondaryContacts),
    customFieldValues: customFieldValueMap(item?.customFieldValues),
    supplier: item?.supplier || sourcingRequest?.supplier || "",
    contactEmail: item?.contactEmail || sourcingRequest?.contactEmail || "",
    notes: item?.notes ?? "",
  };
}

export function sourcingPrimaryFormToPayload(data, customFieldDefs, userSettings) {
  const isFreeware = data.licenseType === "freeware";
  const hasIncludedMaintenance = data.maintenanceCoverage === "included";

  return {
    publisherName: data.publisherName,
    softwareDescription: data.softwareDescription,
    licenseType: data.licenseType || null,
    licenseMetric: data.licenseMetric || null,
    portalUrl: data.licenseType === "saas" ? data.portalUrl || null : null,
    maintenanceCoverage: supportsMaintenanceCoverage(data.licenseType)
      ? (data.maintenanceCoverage || "unknown")
      : null,
    maintenanceStartDate: hasIncludedMaintenance ? data.maintenanceStartDate || null : null,
    maintenanceEndDate: hasIncludedMaintenance ? data.maintenanceEndDate || null : null,
    maintenancePricingBasis: hasIncludedMaintenance ? data.maintenancePricingBasis || "flat" : null,
    maintenanceQuantity: hasIncludedMaintenance
      ? normalizeOptionalNumber(data.maintenanceQuantity, userSettings)
      : null,
    maintenanceUnitPrice: hasIncludedMaintenance
      ? normalizeOptionalNumber(data.maintenanceUnitPrice, userSettings)
      : null,
    maintenanceCost: hasIncludedMaintenance
      ? normalizeOptionalNumber(data.maintenanceCost, userSettings)
      : null,
    quantity: normalizeOptionalNumber(data.quantity, userSettings),
    quantityPerUnit: normalizeOptionalNumber(data.quantityPerUnit, userSettings) || "1",
    skuCode: data.skuCode || null,
    estimatedUnitPrice: isFreeware ? null : normalizeOptionalNumber(data.estimatedUnitPrice, userSettings),
    estimatedTotalPrice: isFreeware ? null : normalizeOptionalNumber(data.estimatedTotalPrice, userSettings),
    currency: data.currency || "EUR",
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    noticeDate: data.noticeDate || null,
    purchaseDate: data.purchaseDate || null,
    contractNumber: data.contractNumber || null,
    invoiceNumber: data.invoiceNumber || null,
    externalRef: data.externalRef || null,
    costCentre: data.costCentre || null,
    budgetOwnerEmail: data.budgetOwnerEmail || null,
    secondaryContacts: parseSecondaryContacts(data.secondaryContacts),
    customFieldValues: buildCustomFieldValuePayload(customFieldDefs, data.customFieldValues, userSettings),
  };
}

export function sourcingAdditionalLineToPayload(line, customFieldDefs, userSettings) {
  return {
    publisherName: line.publisherName,
    softwareDescription: line.softwareDescription,
    licenseType: line.licenseType || null,
    licenseMetric: line.licenseMetric || null,
    portalUrl: line.licenseType === "saas" ? line.portalUrl || null : null,
    quantity: normalizeOptionalNumber(line.quantity, userSettings),
    quantityPerUnit: normalizeOptionalNumber(line.quantityPerUnit, userSettings) || "1",
    skuCode: line.skuCode || null,
    estimatedUnitPrice: normalizeOptionalNumber(line.estimatedUnitPrice, userSettings),
    estimatedTotalPrice: normalizeOptionalNumber(line.estimatedTotalPrice, userSettings),
    currency: line.currency || "EUR",
    startDate: line.startDate || null,
    endDate: line.endDate || null,
    noticeDate: line.noticeDate || null,
    purchaseDate: line.purchaseDate || null,
    contractNumber: line.contractNumber || null,
    invoiceNumber: line.invoiceNumber || null,
    externalRef: line.externalRef || null,
    costCentre: line.costCentre || null,
    budgetOwnerEmail: line.budgetOwnerEmail || null,
    secondaryContacts: parseSecondaryContacts(line.secondaryContacts),
    customFieldValues: buildCustomFieldValuePayload(customFieldDefs, line.customFieldValues, userSettings),
    supplier: line.supplier || null,
    contactEmail: line.contactEmail || null,
    notes: line.notes || null,
    parentItemIndex: line.parentItemIndex,
  };
}

export function sourcingEditFormToPayload(data, customFieldDefs, userSettings) {
  const isFreeware = data.licenseType === "freeware";
  return {
    ...data,
    customFieldValues: buildCustomFieldValuePayload(customFieldDefs, data.customFieldValues, userSettings),
    secondaryContacts: parseSecondaryContacts(data.secondaryContacts),
    quantity: parseLocalizedNumber(data.quantity, userSettings) ?? data.quantity,
    estimatedUnitPrice: isFreeware
      ? null
      : parseLocalizedNumber(data.estimatedUnitPrice, userSettings) ?? data.estimatedUnitPrice,
    estimatedTotalPrice: isFreeware
      ? null
      : parseLocalizedNumber(data.estimatedTotalPrice, userSettings) ?? data.estimatedTotalPrice,
    maintenanceQuantity: normalizeOptionalNumber(data.maintenanceQuantity, userSettings),
    maintenanceUnitPrice: normalizeOptionalNumber(data.maintenanceUnitPrice, userSettings),
    maintenanceCost: normalizeOptionalNumber(data.maintenanceCost, userSettings),
  };
}

export function maintenanceCompanionToPayload(line, parentSourcingItemId, userSettings) {
  return {
    publisherName: line.publisherName,
    softwareDescription: line.softwareDescription,
    licenseType: "maintenance",
    quantity: normalizeOptionalNumber(line.quantity, userSettings),
    estimatedUnitPrice: normalizeOptionalNumber(line.estimatedUnitPrice, userSettings),
    estimatedTotalPrice: normalizeOptionalNumber(line.estimatedTotalPrice, userSettings),
    currency: line.currency || "EUR",
    startDate: line.startDate || null,
    endDate: line.endDate || null,
    supplier: line.supplier || null,
    contactEmail: line.contactEmail || null,
    parentSourcingItemId: parentSourcingItemId ?? null,
  };
}

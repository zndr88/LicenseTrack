import { customFieldValueMap } from "./customFieldFormValues.js";
import { defaultMaintenanceCoverageForLicenseType } from "./maintenanceCoverage.js";
import { formatSecondaryContacts } from "./secondaryContacts.js";

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

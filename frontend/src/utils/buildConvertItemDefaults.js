import { defaultMaintenanceCoverageForLicenseType } from "./maintenanceCoverage.js";

/**
 * Builds conversion form defaults for pending-order items.
 * Pure function - no React, safe to call outside components or in tests.
 *
 * @param {object} order - pending order (must have .poNumber, .supplier, .items[])
 * @param {Array}  licenses - full license list used to prefill renewal fields
 * @param {string} defaultCurrency - configured currency used as the final fallback
 * @returns {Array<object>} - one default-value object per order item
 */
function buildNotes(orderNotes, itemNotes, renewalNotes) {
  const sections = [
    ["Purchase order notes", orderNotes],
    ["Line item notes", itemNotes],
    ["Previous license notes", renewalNotes],
  ];
  const seen = new Set();

  return sections
    .map(([label, value]) => [label, String(value ?? "").trim()])
    .filter(([, value]) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(([label, value]) => `${label}:\n${value}`)
    .join("\n\n");
}

export function buildConvertItemDefaults(order, licenses, defaultCurrency = "EUR") {
  const items = order?.items ?? [];
  return items.map((si) => {
    const renewal =
      si.isRenewal && si.renewalForLicenseId
        ? licenses.find((l) => l.id === si.renewalForLicenseId)
        : null;
    const licenseType = si.licenseType || renewal?.licenseType || "subscription";
    const maintenanceCoverage = si.maintenanceCoverage
      || renewal?.maintenanceCoverage
      || (si.isRenewal ? defaultMaintenanceCoverageForLicenseType(renewal?.licenseType || licenseType) : "unknown");
    return {
      publisherName:       si.publisherName || renewal?.publisherName || "",
      softwareDescription: si.softwareDescription || renewal?.softwareDescription || "",
      startDate:           si.startDate || "",
      endDate:             si.endDate || "",
      purchaseDate:        si.purchaseDate || renewal?.purchaseDate || "",
      isPerpetual:         licenseType === "perpetual",
      contractNumber:      renewal?.contractNumber || "",
      poNumber:            order.poNumber || "",
      procurementReference: order.procurementReference || "",
      invoiceNumber:       "",
      contactEmail:        si.contactEmail || renewal?.contactEmail || "",
      supplier:            order.supplier || si.supplier || renewal?.supplier || "",
      costCentre:          renewal?.costCentre || "",
      licenseType,
      licenseMetric:       renewal?.licenseMetric || "per_user",
      portalUrl:           renewal?.portalUrl || "",
      parentLicenseId:     si.parentSourcingItemId ? "" : renewal?.parentLicenseId || "",
      parentSourcingItemId: si.parentSourcingItemId || "",
      maintenanceCoverage,
      maintenanceStartDate: si.maintenanceStartDate || renewal?.maintenanceStartDate || "",
      maintenanceEndDate:  si.maintenanceEndDate || renewal?.maintenanceEndDate || "",
      maintenancePricingBasis: si.maintenancePricingBasis || renewal?.maintenancePricingBasis || "flat",
      maintenanceQuantity: si.maintenanceQuantity || renewal?.maintenanceQuantity || "",
      maintenanceUnitPrice: si.maintenanceUnitPrice || renewal?.maintenanceUnitPrice || "",
      maintenanceCost:     si.maintenanceCost || renewal?.maintenanceCost || "",
      quantity:            si.quantity || renewal?.quantity || "",
      quantityPerUnit:     renewal?.quantityPerUnit || "1",
      skuCode:             renewal?.skuCode || "",
      unitPrice:           si.estimatedUnitPrice || renewal?.unitPrice || "",
      totalPoPrice:        si.estimatedTotalPrice || renewal?.totalPoPrice || "",
      currency:            si.currency || renewal?.currency || defaultCurrency,
      budgetOwnerEmail:    renewal?.budgetOwnerEmail || "",
      notes:               buildNotes(order.notes, si.notes, renewal?.notes),
    };
  });
}

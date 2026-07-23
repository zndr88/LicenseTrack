/**
 * Builds the useForm defaultValues array for ConvertAllModal.
 * Pure function - no React, safe to call outside components or in tests.
 *
 * @param {object} order - pending order (must have .poNumber, .supplier, .items[])
 * @param {Array}  licenses - full license list used to prefill renewal fields
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

export function buildConvertItemDefaults(order, licenses) {
  const items = order?.items ?? [];
  return items.map((si) => {
    const renewal =
      si.isRenewal && si.renewalForLicenseId
        ? licenses.find((l) => l.id === si.renewalForLicenseId)
        : null;
    return {
      publisherName:       si.publisherName || "",
      softwareDescription: si.softwareDescription || "",
      startDate:           si.startDate || "",
      endDate:             si.endDate || "",
      purchaseDate:        "",
      isPerpetual:         false,
      contractNumber:      renewal?.contractNumber || "",
      poNumber:            order.poNumber || "",
      invoiceNumber:       "",
      contactEmail:        renewal?.contactEmail || "",
      supplier:            renewal?.supplier || order.supplier || "",
      costCentre:          renewal?.costCentre || "",
      licenseType:         renewal?.licenseType || "subscription",
      licenseMetric:       renewal?.licenseMetric || "per_user",
      portalUrl:           renewal?.portalUrl || "",
      parentLicenseId:     "",
      parentSourcingItemId: si.parentSourcingItemId || "",
      maintenanceCoverage: si.maintenanceCoverage || renewal?.maintenanceCoverage || "unknown",
      maintenanceStartDate: si.maintenanceStartDate || renewal?.maintenanceStartDate || "",
      maintenanceEndDate:  si.maintenanceEndDate || renewal?.maintenanceEndDate || "",
      maintenancePricingBasis: si.maintenancePricingBasis || renewal?.maintenancePricingBasis || "flat",
      maintenanceQuantity: si.maintenanceQuantity || renewal?.maintenanceQuantity || "",
      maintenanceUnitPrice: si.maintenanceUnitPrice || renewal?.maintenanceUnitPrice || "",
      maintenanceCost:     si.maintenanceCost || renewal?.maintenanceCost || "",
      quantity:            si.quantity || renewal?.quantity || "",
      skuCode:             renewal?.skuCode || "",
      unitPrice:           si.estimatedUnitPrice || renewal?.unitPrice || "",
      totalPoPrice:        si.estimatedTotalPrice || renewal?.totalPoPrice || "",
      currency:            si.currency || renewal?.currency || "EUR",
      budgetOwnerEmail:    renewal?.budgetOwnerEmail || "",
      notes:               buildNotes(order.notes, si.notes, renewal?.notes),
    };
  });
}

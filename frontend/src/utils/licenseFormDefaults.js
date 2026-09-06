const LICENSE_DRAFT_SUPPLEMENT_DEFAULTS = Object.freeze({
  licenseType: "",
  licenseMetric: "per_user",
  portalUrl: "",
  quantityPerUnit: "1",
  skuCode: "",
  maintenanceCoverage: "unknown",
  maintenanceStartDate: "",
  maintenanceEndDate: "",
  maintenancePricingBasis: "flat",
  maintenanceQuantity: "",
  maintenanceUnitPrice: "",
  maintenanceCost: "",
  startDate: "",
  endDate: "",
  noticeDate: "",
  purchaseDate: "",
  contractNumber: "",
  invoiceNumber: "",
  externalRef: "",
  costCentre: "",
  budgetOwnerEmail: "",
  secondaryContacts: "",
  notes: "",
});

export function createLicenseDraftSupplementDefaults() {
  return {
    ...LICENSE_DRAFT_SUPPLEMENT_DEFAULTS,
    customFieldValues: {},
  };
}

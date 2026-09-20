/**
 * Build the prefill for a separate maintenance/support line that accompanies a
 * parent license line. Single source of truth for the companion field mapping so
 * every modal (sourcing, pending order, manual) inherits the same fields.
 *
 * @param {object} parent - the parent line/form the companion is created from.
 * @param {object} options
 * @param {() => string} options.idFactory - generates the companion's line id.
 * @param {string} [options.parentLineId] - overrides the parent reference
 *   (e.g. a modal's PRIMARY_LINE_ID); defaults to `parent.id`.
 */
export function buildMaintenanceCompanion(parent = {}, { idFactory, parentLineId } = {}) {
  return {
    id: idFactory ? idFactory() : `${Date.now()}-${Math.random()}`,
    licenseType: "maintenance",
    isMaintenanceCompanion: true,
    parentLineId: parentLineId ?? parent.id ?? null,
    publisherName: parent.publisherName ?? "",
    softwareDescription: `${parent.softwareDescription || "Software"} maintenance/support`,
    quantity: parent.quantity || "1",
    quantityPerUnit: parent.quantityPerUnit || "1",
    currency: parent.currency || "EUR",
    startDate: parent.maintenanceStartDate || parent.startDate || "",
    endDate: parent.maintenanceEndDate || parent.endDate || "",
    supplier: parent.supplier ?? "",
    contactEmail: parent.contactEmail ?? "",
    costCentre: parent.costCentre ?? "",
    budgetOwnerEmail: parent.budgetOwnerEmail ?? "",
    secondaryContacts: parent.secondaryContacts ?? "",
  };
}

const HIDDEN_FIELDS_BY_STAGE = Object.freeze({
  sourcing: new Set(["purchaseDate", "invoiceNumber", "externalRef"]),
  pending: new Set(),
  conversion: new Set(),
  license: new Set(),
});

export function isProcurementFieldVisible(stage, fieldName) {
  const hiddenFields = HIDDEN_FIELDS_BY_STAGE[stage];
  if (!hiddenFields) throw new Error(`Unknown procurement stage: ${stage}`);
  return !hiddenFields.has(fieldName);
}

export function getProcurementFormVisibility(stage) {
  return {
    purchaseDate: isProcurementFieldVisible(stage, "purchaseDate"),
    invoiceNumber: isProcurementFieldVisible(stage, "invoiceNumber"),
    externalRef: isProcurementFieldVisible(stage, "externalRef"),
  };
}

/** Fields the batch conversion "Copy shared fields" action copies from item 1. */
export const SHARED_FIELD_KEYS = [
  "poNumber",
  "procurementReference",
  "contractNumber",
  "invoiceNumber",
  "purchaseDate",
  "contactEmail",
  "supplier",
  "costCentre",
  "currency",
  "budgetOwnerEmail",
  "secondaryContacts",
];

const isFilled = (value) => (Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== "");

/** Return the shared values worth copying: blank source values never overwrite a target. */
export function pickFilledSharedFields(source) {
  if (!source) return {};
  return Object.fromEntries(SHARED_FIELD_KEYS.filter((key) => isFilled(source[key])).map((key) => [key, source[key]]));
}

export function sharedFieldsCopyMessage(fieldCount, lineCount) {
  if (fieldCount === 0) return "Nothing to copy — the first line has no shared values";
  return `Copied ${fieldCount} ${fieldCount === 1 ? "field" : "fields"} to ${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

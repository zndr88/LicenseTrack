export const PROCUREMENT_DOCUMENT_CATEGORIES = new Set(["invoice", "quote", "purchase_order"]);

export const DOCUMENT_CATEGORY_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "quote", label: "Quote" },
  { value: "purchase_order", label: "Purchase Order" },
  { value: "eula", label: "EULA" },
  { value: "entitlement", label: "Entitlement / License Key" },
];

export function documentCategoryLabel(category) {
  return DOCUMENT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? "Document";
}

export function isProcurementDocumentCategory(category) {
  return PROCUREMENT_DOCUMENT_CATEGORIES.has(category);
}

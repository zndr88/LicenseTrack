export const PROCUREMENT_DOCUMENT_CATEGORIES = new Set(["invoice", "quote", "purchase_order"]);

export const DOCUMENT_CATEGORIES = [
  { key: "quote", label: "Quote", shortLabel: "Quote", icon: "file", color: "var(--purple-text)" },
  { key: "purchase_order", label: "Purchase Order", shortLabel: "Purchase Order", icon: "file", color: "var(--accent)" },
  { key: "invoice", label: "Invoice", shortLabel: "Invoice", icon: "file", color: "var(--green-text)" },
  { key: "eula", label: "EULA Documents", shortLabel: "EULA", icon: "shield", color: "var(--green)" },
  { key: "entitlement", label: "Proof of Entitlement / Serial Keys", shortLabel: "Entitlement / License Key", icon: "key", color: "var(--orange)" },
];

export const DOCUMENT_CATEGORY_OPTIONS = ["invoice", "quote", "purchase_order", "eula", "entitlement"].map((key) => {
  const category = DOCUMENT_CATEGORIES.find((item) => item.key === key);
  return { value: key, label: category.shortLabel };
});

export function documentCategoryLabel(category) {
  return DOCUMENT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? "Document";
}

export function isProcurementDocumentCategory(category) {
  return PROCUREMENT_DOCUMENT_CATEGORIES.has(category);
}

export function documentFileIconColor(filename = "") {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "var(--red)";
  if (name.endsWith(".txt") || name.endsWith(".lic")) return "var(--text-2)";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "var(--accent)";
  return "var(--text-3)";
}

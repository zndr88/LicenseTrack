export const PROCUREMENT_DOCUMENT_CATEGORIES = new Set(["invoice", "quote", "purchase_order"]);

export const DOCUMENT_CATEGORIES = [
  { key: "quote", label: "Quote", shortLabel: "Quote", icon: "file", color: "var(--purple-text)", defaultScope: "shared" },
  { key: "purchase_order", label: "Purchase Order", shortLabel: "Purchase Order", icon: "file", color: "var(--accent)", defaultScope: "shared" },
  { key: "invoice", label: "Invoice", shortLabel: "Invoice", icon: "file", color: "var(--green-text)", defaultScope: "shared" },
  { key: "eula", label: "EULA Documents", shortLabel: "EULA", icon: "shield", color: "var(--green)", defaultScope: "license" },
  { key: "entitlement", label: "Proof of Entitlement / Serial Keys", shortLabel: "Entitlement / License Key", icon: "key", color: "var(--orange)", defaultScope: "license" },
];

export function defaultDocumentScope(category) {
  return DOCUMENT_CATEGORIES.find((item) => item.key === category)?.defaultScope
    ?? (isProcurementDocumentCategory(category) ? "shared" : "license");
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

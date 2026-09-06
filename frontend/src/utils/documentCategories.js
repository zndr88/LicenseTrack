export const PROCUREMENT_DOCUMENT_CATEGORIES = new Set(["invoice", "quote", "purchase_order"]);

export const DOCUMENT_CATEGORIES = [
  { key: "quote", label: "Quote", shortLabel: "Quote", icon: "file", color: "var(--purple-text)" },
  { key: "purchase_order", label: "Purchase Order", shortLabel: "Purchase Order", icon: "file", color: "var(--accent)" },
  { key: "invoice", label: "Invoice", shortLabel: "Invoice", icon: "file", color: "var(--green-text)" },
  { key: "eula", label: "EULA Documents", shortLabel: "EULA", icon: "shield", color: "var(--green)" },
  { key: "entitlement", label: "Proof of Entitlement / Serial Keys", shortLabel: "Entitlement / License Key", icon: "key", color: "var(--orange)" },
];

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

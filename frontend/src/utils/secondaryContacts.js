export function parseSecondaryContacts(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((contact) => contact.trim())
    .filter(Boolean);
}

export function formatSecondaryContacts(contacts) {
  return (contacts || []).join(", ");
}

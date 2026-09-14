export function parseSecondaryContacts(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((contact) => contact.trim())
    .filter(Boolean);
}

export function formatSecondaryContacts(contacts) {
  if (Array.isArray(contacts)) {
    return contacts.filter(Boolean).join(", ");
  }
  if (typeof contacts === "string") {
    return contacts.trim();
  }
  return "";
}

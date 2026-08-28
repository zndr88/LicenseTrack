/**
 * Email domain like "example.com" (a leading @ is stripped automatically).
 * Empty -> error.
 */
export function allowedEmailDomain(value) {
  let v = (value ?? "").trim().toLowerCase();
  if (v.startsWith("@")) v = v.slice(1);
  if (!v) return "Domain is required.";
  if (v.includes(" ") || v.includes("@") || !v.includes(".")) {
    return "Must be a valid domain (e.g. example.com).";
  }
  return null;
}

/** Preserve valid integer input, including zero, and leave invalid/blank text for schema validation. */
export function parseIntegerInput(value) {
  if (value === "") return "";
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : value;
}

/**
 * Client-side field validators.
 * Each function returns an error string, or null when the value is valid.
 */

/** Matches "user@domain.tld" strictly (no spaces, one @, one dot after @). */
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Non-empty string (after trim). */
export function requiredString(value, fieldName = "This field") {
  if (!(value ?? "").trim()) return `${fieldName} is required.`;
  return null;
}

/** Empty/blank is OK; non-empty must be a valid email address. */
export function optionalEmail(value) {
  const v = (value ?? "").trim();
  if (!v) return null;
  return isEmail(v) ? null : "Must be a valid email address.";
}

/** Non-empty and must be a valid email address. */
export function requiredEmail(value, fieldName = "Email") {
  const v = (value ?? "").trim();
  if (!v) return `${fieldName} is required.`;
  return isEmail(v) ? null : "Must be a valid email address.";
}

/**
 * Email domain like "company.com" (a leading @ is stripped automatically).
 * Empty -> error.
 */
export function allowedEmailDomain(value) {
  let v = (value ?? "").trim().toLowerCase();
  if (v.startsWith("@")) v = v.slice(1);
  if (!v) return "Domain is required.";
  if (v.includes(" ") || v.includes("@") || !v.includes(".")) {
    return "Must be a valid domain (e.g. company.com).";
  }
  return null;
}

/**
 * Absolute https:// URL.
 * Empty -> error (use optionalHttpsUrl for optional fields).
 */
export function httpsUrl(value, fieldName = "URL") {
  const v = (value ?? "").trim();
  if (!v) return `${fieldName} is required.`;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:") return `${fieldName} must use HTTPS.`;
    return null;
  } catch {
    return `${fieldName} must be a valid URL (e.g. https://example.com/path).`;
  }
}

/** Integer in the 0-23 range. */
export function hourRange(value) {
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) return "Must be an hour between 0 and 23.";
  return null;
}

/** Integer in the 1-100 range. */
export function keepRange(value) {
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) return "Must be between 1 and 100.";
  return null;
}

/**
 * SMTP sender: empty is OK (optional field).
 * Accepts plain "email@example.com" or "Display Name <email@example.com>".
 */
export function senderAddress(value) {
  const v = (value ?? "").trim();
  if (!v) return null;
  const angleMatch = v.match(/<([^>]+)>/);
  const email = angleMatch ? angleMatch[1].trim() : v;
  return isEmail(email)
    ? null
    : "Sender must be a valid email address or 'Name <email@example.com>'.";
}

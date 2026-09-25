/**
 * Locale-aware formatting utilities.
 *
 * parseTypedNumber - converts number text typed by the user (any locale) to
 *   a canonical decimal string ("1234.50") or null.
 * toInputText - formats a canonical value as editable text in the user's
 *   locale, keeping every decimal.
 *
 * All other functions are display-only - they produce human-readable strings
 * from canonical server values.
 */

// Locale separator detection

function getSupportedLocale(locale) {
  try {
    if (Intl.NumberFormat.supportedLocalesOf([locale]).length === 0) return "en-US";
    return new Intl.NumberFormat(locale).resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

function getDecimalSep(locale) {
  const parts = new Intl.NumberFormat(getSupportedLocale(locale)).formatToParts(1.1);
  const dec = parts.find((p) => p.type === "decimal");
  return dec ? dec.value : ".";
}

function getGroupSep(locale) {
  const parts = new Intl.NumberFormat(getSupportedLocale(locale)).formatToParts(1000);
  const grp = parts.find((p) => p.type === "group");
  return grp ? grp.value : "";
}

// parseTypedNumber / toInputText

const CANONICAL_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Convert number text TYPED BY THE USER (in their locale) to a canonical
 * decimal string ("1234.50") or null.
 *
 * Only pass user-typed text. Values from the server are already canonical:
 * display them with toInputText() and never re-parse them. As a safety net,
 * canonical input is returned unchanged, so parsing twice is harmless.
 *
 * @param {string|null|undefined} raw - User input
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {string|null}
 */
export function parseTypedNumber(raw, settings) {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim();
  if (!str) return null;

  const locale = getSupportedLocale(settings?.numberFormatLocale || "en-US");
  const decSep = getDecimalSep(locale);
  const grpSep = getGroupSep(locale);

  let s = str.replace(/\p{Sc}/gu, "").trim();
  const compact = s.replace(/[\u00a0\u202f\s]/g, "");

  // Decision D1: in comma-decimal locales, a single dot with no comma is a
  // decimal point (a canonical value or a dot typed as decimal), never a
  // thousands group. Grouped input has two or more groups ("1.234.567") or a
  // decimal part ("1.234,5").
  if (decSep !== "." && !compact.includes(decSep) && /^-?\d+\.\d+$/.test(compact)) {
    return compact;
  }

  const hasLocaleDecimal = decSep !== "." && s.includes(decSep);
  if (grpSep) {
    const esc = grpSep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const decEsc = decSep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const groupingPattern = new RegExp(`^-?\\d{1,3}(${esc}\\d{3})+(${decEsc}\\d+)?$`);
    if (hasLocaleDecimal || groupingPattern.test(s)) {
      s = s.replace(new RegExp(esc, "g"), "");
    }
  }
  // Also strip all whitespace-like group separators (space, NBSP, NNBSP)
  s = s.replace(/[\u00a0\u202f\s]/g, "");
  // Normalise the decimal separator to "."; a malformed string with several
  // decimal separators is rejected by the canonical check below.
  if (decSep !== ".") {
    s = s.replaceAll(decSep, ".");
  }
  if (!CANONICAL_NUMBER.test(s)) return null;
  return s;
}

/**
 * Format a CANONICAL number ("1234.567") as editable text in the user's
 * locale ("1.234,567"), keeping every decimal. Non-canonical text is
 * returned unchanged.
 *
 * @param {string|number|null|undefined} value
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @param {{ minFractionDigits?: number }} [options]
 * @returns {string}
 */
export function toInputText(value, settings, { minFractionDigits = 0 } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value).trim();
  if (!CANONICAL_NUMBER.test(raw)) return raw;
  const locale = getSupportedLocale(settings?.numberFormatLocale || "en-US");
  const negative = raw.startsWith("-");
  const [intPart, fracPart = ""] = (negative ? raw.slice(1) : raw).split(".");
  const fraction = fracPart.padEnd(minFractionDigits, "0");
  const grpSep = getGroupSep(locale);
  const decimalPart = fraction ? getDecimalSep(locale) + fraction : "";
  const sign = negative ? "-" : "";
  const grouped = grpSep ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grpSep) : intPart;
  const text = `${sign}${grouped}${decimalPart}`;
  // Decision D1 reads a single dot group with no decimal part ("1.000") as a
  // decimal, so leave the grouping out when it would not read back the same.
  const expected = `${sign}${intPart}${fraction ? `.${fraction}` : ""}`;
  if (grouped !== intPart && parseTypedNumber(text, settings) !== expected) {
    return `${sign}${intPart}${decimalPart}`;
  }
  return text;
}

// formatPriceDisplay

/**
 * Format a canonical decimal string for display in the user's locale.
 * Returns empty string for null/empty/non-parseable input.
 *
 * @param {string|null|undefined} canonical - e.g. "1234.50"
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {string}
 */
export function formatPriceDisplay(canonical, settings) {
  if (canonical == null || canonical === "") return "";
  const num = Number(canonical);
  if (isNaN(num)) return "";
  const locale = settings?.numberFormatLocale ?? "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return "";
  }
}

// formatMoney

/**
 * Format a canonical decimal string as a currency display string.
 * Returns empty string for null/empty input.
 *
 * @param {string|null|undefined} canonical - e.g. "1234.50"
 * @param {string} currency - ISO 4217 code, e.g. "EUR"
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {string}
 */
export function formatMoney(canonical, currency, settings) {
  if (canonical == null || canonical === "") return "";
  const num = Number(canonical);
  if (isNaN(num)) return "";
  const locale = settings?.numberFormatLocale ?? "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${formatPriceDisplay(canonical, settings)}`;
  }
}

// formatDate

/**
 * Format a YYYY-MM-DD server string into the user's preferred date format.
 * Never passes through new Date() to avoid UTC-offset drift.
 *
 * @param {string|null|undefined} isoDate - e.g. "2025-12-31"
 * @param {object} [settings] - { dateFormat?: "DD/MM/YYYY"|"MM/DD/YYYY"|"YYYY-MM-DD" }
 * @returns {string}
 */
export function formatDate(isoDate, settings) {
  if (!isoDate) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, yyyy, mm, dd] = match;
  const fmt = settings?.dateFormat ?? "DD/MM/YYYY";
  switch (fmt) {
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
    default:           return `${dd}/${mm}/${yyyy}`;   // DD/MM/YYYY
  }
}

// formatDateTime

/**
 * Format an ISO datetime string into "date time" using user settings.
 *
 * @param {string|null|undefined} iso - e.g. "2025-12-31T14:30:00Z"
 * @param {object} [settings] - { dateFormat?, timeFormat?: "12h"|"24h" }
 * @returns {string}
 */
export function formatDateTime(iso, settings) {
  if (!iso) return "";
  const text = String(iso).trim();
  const offsetlessServerDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
  const normalizedIso = offsetlessServerDateTime
    ? `${text.replace(" ", "T")}Z`
    : text;
  const d = new Date(normalizedIso);
  if (isNaN(d.getTime())) return iso;

  const timeZone = settings?.timeZone || "UTC";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
  }
  const valueOf = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const datePart = formatDate(
    `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`,
    settings
  );

  const use12h = settings?.timeFormat === "12h";
  const hours = Number(valueOf("hour"));
  const minutes = valueOf("minute");

  let timePart;
  if (use12h) {
    const h12 = hours % 12 || 12;
    const ampm = hours < 12 ? "AM" : "PM";
    timePart = `${h12}:${minutes} ${ampm}`;
  } else {
    timePart = `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  return `${datePart} ${timePart}`;
}

// formatNumber

/**
 * Format an integer for display in the user's locale (thousands separators).
 *
 * @param {number|null|undefined} value
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {string}
 */
export function formatNumber(value, settings) {
  if (value == null) return "";
  const locale = settings?.numberFormatLocale ?? "en-US";
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(value);
  }
}

// formatFileSize

/**
 * Format a byte count as a human-readable size string.
 *
 * @param {number} bytes
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {string}
 */
export function formatFileSize(bytes, settings) {
  const locale = getSupportedLocale(settings?.numberFormatLocale || "en-US");
  const format = (value, minimumFractionDigits = 0) => new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  }).format(value);
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${format(bytes / 1024, 1)} KB`;
  return `${format(bytes / (1024 * 1024), 1)} MB`;
}

/**
 * Locale-aware formatting utilities.
 *
 * parseTypedNumberResult / parseTypedNumber - read number text TYPED BY THE
 *   USER in their number format, exactly once (in NumberInput). They use the
 *   same rules and separators as the backend's parse_localized_money; both
 *   run backend/tests/fixtures/number_parsing_cases.json.
 * toInputText - formats a canonical value as editable text in the user's
 *   number format, keeping every decimal.
 *
 * All other functions are display-only - they produce human-readable strings
 * from canonical server values.
 */

import numberFormats from "../generated/numberFormats.json";

function getSupportedLocale(locale) {
  try {
    if (Intl.NumberFormat.supportedLocalesOf([locale]).length === 0) return "en-US";
    return new Intl.NumberFormat(locale).resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

// Separators come from the backend's table (generated file), not from the
// browser's locale data, which varies between browsers and versions.
function separatorsFor(settings) {
  const locale = settings?.numberFormatLocale || "en-US";
  const entry = numberFormats.separators[locale] ?? numberFormats.separators["en-US"];
  return { decimal: entry.decimal, group: entry.group };
}

const CANONICAL_NUMBER = /^-?\d+(\.\d+)?$/;
const WHITESPACE = /[\s\u00a0\u202f\u2009]/g;
const IS_WHITESPACE = /^[\s\u00a0\u202f\u2009]$/;
// A single dot group ("1.234") under a dot-grouping, comma-decimal format.
const AMBIGUOUS_DOT = /^-?[1-9]\d{0,2}\.\d{3}$/;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripCurrency(text) {
  let value = text.trim();
  const symbols = numberFormats.currencySymbols;
  if (value && symbols.includes(value[0])) value = value.slice(1).trim();
  if (value && symbols.includes(value[value.length - 1])) value = value.slice(0, -1).trim();
  const words = value.split(/\s+/);
  if (words.length > 1 && numberFormats.currencyCodes.includes(words[0].toUpperCase())) value = words.slice(1).join(" ");
  const tail = value.split(/\s+/);
  if (tail.length > 1 && numberFormats.currencyCodes.includes(tail[tail.length - 1].toUpperCase())) {
    value = tail.slice(0, -1).join(" ");
  }
  return value;
}

/**
 * Read number text TYPED BY THE USER in their number format.
 *
 * Returns { value, error }:
 * - value: canonical decimal string ("1234.50"), or null for blank or rejected input;
 * - error: null, "invalid" (doesn't match the number format) or "ambiguous"
 *   ("1.234" under a dot-grouping, comma-decimal format).
 *
 * Only NumberInput (and user-typed filters) should call this. Stored values
 * are already canonical: never re-read them as typed text.
 *
 * @param {string|null|undefined} raw
 * @param {object} [settings] - { numberFormatLocale?: string }
 * @returns {{ value: string|null, error: null|"invalid"|"ambiguous" }}
 */
export function parseTypedNumberResult(raw, settings) {
  if (raw == null) return { value: null, error: null };
  const text = stripCurrency(String(raw)).replace(WHITESPACE, "");
  if (!text) return { value: null, error: null };
  const { decimal, group: rawGroup } = separatorsFor(settings);
  const group = rawGroup && !IS_WHITESPACE.test(rawGroup) ? rawGroup : null;

  if (CANONICAL_NUMBER.test(text)) {
    if (decimal !== "." && group === "." && AMBIGUOUS_DOT.test(text)) return { value: null, error: "ambiguous" };
    return { value: text, error: null };
  }
  const dec = escapeRegExp(decimal);
  const plain = new RegExp(`^-?\\d+(${dec}\\d+)?$`);
  const grouped = group ? new RegExp(`^-?\\d{1,3}(${escapeRegExp(group)}\\d{3})+(${dec}\\d+)?$`) : null;
  if (plain.test(text) || (grouped && grouped.test(text))) {
    const canonical = (group ? text.split(group).join("") : text).split(decimal).join(".");
    if (CANONICAL_NUMBER.test(canonical)) return { value: canonical, error: null };
  }
  return { value: null, error: "invalid" };
}

/**
 * Canonical value of typed text, or null when blank or rejected.
 * Prefer parseTypedNumberResult where the reason matters.
 */
export function parseTypedNumber(raw, settings) {
  return parseTypedNumberResult(raw, settings).value;
}

/**
 * A short example of the user's number format ("1.234,56"), for messages.
 */
export function numberFormatExample(settings) {
  return toInputText("1234.56", settings);
}

/**
 * Format a CANONICAL number ("1234.567") as editable text in the user's
 * number format ("1.234,567"), keeping every decimal. Non-canonical text is
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
  const { decimal, group } = separatorsFor(settings);
  const negative = raw.startsWith("-");
  const [intPart, fracPart = ""] = (negative ? raw.slice(1) : raw).split(".");
  const fraction = fracPart.padEnd(minFractionDigits, "0");
  const decimalPart = fraction ? decimal + fraction : "";
  const sign = negative ? "-" : "";
  const grouped = group ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group) : intPart;
  const text = `${sign}${grouped}${decimalPart}`;
  // Leave the grouping out when it wouldn't read back as the same number
  // (for example "1.000" is ambiguous under de-DE).
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

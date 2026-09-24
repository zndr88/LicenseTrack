/** Date helpers - all fixture dates are relative to "now" so the demo never goes stale. */

/**
 * Serialize a Date's LOCAL calendar day as "YYYY-MM-DD".
 * Not toISOString(): that converts to UTC first, which for the first N hours
 * of the local day in a UTC+N timezone slips the date one day earlier.
 * daysUntil() below parses dates as local midnight, so local serialization
 * here keeps the pair internally consistent.
 */
function toLocalIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalIsoDate(d); // "YYYY-MM-DD", local calendar day
}

function parseIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Shift an ISO date by whole days. */
export function addDaysIso(isoDate, days) {
  const d = parseIsoDate(isoDate);
  d.setDate(d.getDate() + days);
  return toLocalIsoDate(d);
}

/**
 * The app's term convention: a term of N years ends the day before the
 * N-year anniversary of its start (end = start + N years - 1 day).
 */
export function termEnd(startIsoDate, years = 1) {
  const d = parseIsoDate(startIsoDate);
  d.setFullYear(d.getFullYear() + years);
  d.setDate(d.getDate() - 1);
  return toLocalIsoDate(d);
}

/** The start of an N-year term that ends on endIsoDate (inverse of termEnd). */
export function termStart(endIsoDate, years = 1) {
  const d = parseIsoDate(endIsoDate);
  d.setDate(d.getDate() + 1);
  d.setFullYear(d.getFullYear() - years);
  return toLocalIsoDate(d);
}

/** Inclusive calendar days of a term, or null when either end is missing. */
export function inclusiveTermDays(startIsoDate, endIsoDate) {
  if (!startIsoDate || !endIsoDate) return null;
  const start = Date.parse(`${startIsoDate}T00:00:00Z`);
  const end = Date.parse(`${endIsoDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function datetimeDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString(); // full ISO datetime
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target - today) / 86_400_000);
}

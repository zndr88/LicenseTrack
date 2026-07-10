/** Date helpers — all fixture dates are relative to "now" so the demo never goes stale. */

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

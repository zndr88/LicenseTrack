import { parseLocalizedNumber } from "../../utils/formatting.js";
import { formatCost } from "../../utils/helpers.js";

/** Returns quantity x unit price when an entered line total differs from it, else null. */
export function lineTotalMismatch(quantity, unitPrice, total, settings) {
  const qty = Number(parseLocalizedNumber(quantity, settings));
  const unit = Number(parseLocalizedNumber(unitPrice, settings));
  const entered = Number(parseLocalizedNumber(total, settings));
  if ([quantity, unitPrice, total].some((value) => String(value ?? "").trim() === "")) return null;
  if (![qty, unit, entered].every(Number.isFinite)) return null;
  const expected = qty * unit;
  return Math.abs(expected - entered) >= 0.005 ? expected : null;
}

/** Non-blocking hint shown under an Est. Line Total that differs from quantity x unit price. */
export default function LineTotalMismatchHint({ quantity, unitPrice, total, currency, settings }) {
  const expected = lineTotalMismatch(quantity, unitPrice, total, settings);
  if (expected === null) return null;
  return (
    <span className="field-hint">
      Differs from quantity × unit price ({formatCost(expected, currency || "EUR", settings?.numberFormatLocale ?? "en-US")})
    </span>
  );
}

import { isValidNumberValue } from "../../utils/formatting.js";
import { formatCost } from "../../utils/helpers.js";

/**
 * Returns quantity x unit price when an entered line total differs from it, else null.
 * The values are canonical form numbers (NumberInput); invalid ones give no hint.
 */
export function lineTotalMismatch(quantity, unitPrice, total, _settings) {
  if ([quantity, unitPrice, total].some((value) => String(value ?? "").trim() === "" || !isValidNumberValue(value))) return null;
  const qty = Number(quantity);
  const unit = Number(unitPrice);
  const entered = Number(total);
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

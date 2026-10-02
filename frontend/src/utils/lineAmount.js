// The one frontend owner of a license line's amount (MONEY-2): Line Total is
// always quantity x unit price. Mirrors backend calc_line_total and
// unit_price_from_total in services/license_service.py.

const CANONICAL = /^-?\d+(\.\d+)?$/;

function canonicalNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!CANONICAL.test(text)) return null;
  return Number(text);
}

export function getLineAmount(license) {
  const quantity = canonicalNumber(license?.quantity);
  const unitPrice = canonicalNumber(license?.unitPrice);
  return quantity === null || unitPrice === null ? null : quantity * unitPrice;
}

// Line amount as a two-decimal string for money inputs (empty when unknown).
export function getLineAmountText(license) {
  const amount = getLineAmount(license);
  return amount === null ? "" : amount.toFixed(2);
}

export function unitPriceFromTotal(total, quantity) {
  const parsedTotal = canonicalNumber(total);
  const parsedQuantity = canonicalNumber(quantity);
  if (parsedTotal === null || parsedQuantity === null || parsedQuantity === 0) return null;
  const text = (parsedTotal / parsedQuantity).toFixed(6);
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

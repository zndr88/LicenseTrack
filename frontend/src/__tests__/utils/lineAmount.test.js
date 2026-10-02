// Shared line-amount cases, also run by the backend
// (backend/tests/test_unit/test_line_amount.py).
import { describe, expect, it } from "vitest";
import { getLineAmount, unitPriceFromTotal } from "../../utils/lineAmount.js";
import cases from "../../../../backend/tests/fixtures/line_amount_cases.json";

describe("shared line amount cases", () => {
  it.each(cases.line_amount.map((c) => [`${c.quantity} x ${c.unit_price}`, c]))("%s", (_label, c) => {
    const result = getLineAmount({ quantity: c.quantity, unitPrice: c.unit_price });
    if (c.expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(Number(c.expected), 9);
  });
});

describe("shared unit price from total cases", () => {
  it.each(cases.unit_price_from_total.map((c) => [`${c.total} / ${c.quantity}`, c]))("%s", (_label, c) => {
    expect(unitPriceFromTotal(c.total, c.quantity)).toBe(c.expected);
  });
});

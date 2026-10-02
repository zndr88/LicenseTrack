// Shared line-amount cases, also run by the backend
// (backend/tests/test_unit/test_line_amount.py).
import { describe, expect, it } from "vitest";
import { getLineAmount, getLineAmountText, unitPriceFromTotal } from "../../utils/lineAmount.js";
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

describe("getLineAmountText", () => {
  it("formats the amount with two decimals and hides float noise", () => {
    expect(getLineAmountText({ quantity: "3", unitPrice: "33.3333" })).toBe("100.00");
    expect(getLineAmountText({ quantity: "5", unitPrice: "12.80" })).toBe("64.00");
  });

  it("is empty when the line amount is unknown", () => {
    expect(getLineAmountText({ quantity: "", unitPrice: "12.80" })).toBe("");
  });
});

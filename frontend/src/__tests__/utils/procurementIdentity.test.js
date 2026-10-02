import { describe, expect, it } from "vitest";
import { getProcurementBreakdown, getProcurementTotal } from "../../utils/procurementIdentity.js";

const line = (overrides) => ({ id: 1, poNumber: "PO-1", currency: "EUR", quantity: "1", unitPrice: "100", ...overrides });

describe("getProcurementBreakdown", () => {
  it("sums quantity x unit price of non-retired lines with the same identity", () => {
    const all = [line({ id: 1 }), line({ id: 2, quantity: "2", unitPrice: "50" }), line({ id: 3, retired: true }), line({ id: 4, poNumber: "PO-2" })];
    expect(getProcurementBreakdown(all[0], all)).toEqual({ lineSum: 200, override: null, total: 200 });
  });

  it("uses the manual PO total once when one line carries it", () => {
    const all = [line({ id: 1, poTotalOverride: "180" }), line({ id: 2 })];
    expect(getProcurementBreakdown(all[1], all)).toEqual({ lineSum: 200, override: 180, total: 180 });
  });

  it("matches PO numbers regardless of case and spacing", () => {
    const all = [line({ id: 1, poNumber: " po-1 " }), line({ id: 2, poNumber: "PO-1" })];
    expect(getProcurementBreakdown(all[0], all).lineSum).toBe(200);
  });

  it("returns zeros without a procurement identity", () => {
    expect(getProcurementBreakdown({ id: 9 }, [])).toEqual({ lineSum: 0, override: null, total: 0 });
  });

  it("getProcurementTotal returns the breakdown total", () => {
    const all = [line({ id: 1, poTotalOverride: "180" }), line({ id: 2 })];
    expect(getProcurementTotal(all[1], all)).toBe(180);
  });
});

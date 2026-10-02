import { describe, expect, it } from "vitest";
import { getIndexedProcurementBreakdown, getProcurementBreakdown, getProcurementTotal, indexProcurementLines } from "../../utils/procurementIdentity.js";

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

describe("indexed procurement breakdown", () => {
  it("gives the same figures as the unindexed breakdown for every line", () => {
    const all = [
      line({ id: 1, poTotalOverride: "180" }),
      line({ id: 2, quantity: "3" }),
      line({ id: 3, retired: true }),
      line({ id: 4, poNumber: "PO-2", currency: "USD" }),
      line({ id: 5, poNumber: " po-2 ", currency: "USD", unitPrice: "" }),
      line({ id: 6, pendingOrderId: 7 }),
      line({ id: 7, pendingOrderId: 7, unitPrice: "20" }),
      { id: 8, poNumber: "", currency: "EUR", quantity: "1", unitPrice: "5" },
      { id: 9, poNumber: "PO-3", currency: "", quantity: "1", unitPrice: "5" },
    ];
    const index = indexProcurementLines(all);
    for (const license of all) {
      expect(getIndexedProcurementBreakdown(license, index)).toEqual(getProcurementBreakdown(license, all));
    }
  });
});

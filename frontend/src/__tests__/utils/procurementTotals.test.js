import { describe, expect, it } from "vitest";
import { manualPoTotalNote, pendingOrderOverrideCurrency } from "../../utils/procurementTotals.js";

describe("manual PO totals", () => {
  it("apply only to single-currency orders", () => {
    const items = [{ currency: "EUR" }, { currency: "eur" }, { currency: "USD", status: "cancelled" }];
    expect(pendingOrderOverrideCurrency({ poTotalOverride: "10", items })).toBe("EUR");
    expect(pendingOrderOverrideCurrency({ poTotalOverride: "10", items: [...items, { currency: "USD" }] })).toBeNull();
    expect(pendingOrderOverrideCurrency({ poTotalOverride: null, items })).toBeNull();
  });

  it("describe the annual-cost note", () => {
    expect(manualPoTotalNote(0)).toBe("");
    expect(manualPoTotalNote(1)).toBe("1 PO has a manual total not reflected here.");
    expect(manualPoTotalNote(3)).toBe("3 POs have a manual total not reflected here.");
  });
});

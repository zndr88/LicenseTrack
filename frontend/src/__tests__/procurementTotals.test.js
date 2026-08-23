import { describe, expect, test } from "vitest";
import {
  compareProcurementTotals,
  procurementLineTotal,
  procurementTotalsByCurrency,
} from "../utils/procurementTotals.js";

describe("procurementLineTotal", () => {
  test("does not double count bundled subscription support", () => {
    expect(procurementLineTotal({
      licenseType: "subscription",
      estimatedTotalPrice: "2000.00",
      maintenanceCoverage: "included",
      maintenanceCost: "2000.00",
    })).toBe(2000);
  });

  test("still adds separately priced included support for eligible parent models", () => {
    expect(procurementLineTotal({
      licenseType: "perpetual",
      estimatedTotalPrice: "2000.00",
      maintenanceCoverage: "included",
      maintenanceCost: "600.00",
    })).toBe(2600);
  });

  test("groups canonical line totals by currency", () => {
    expect(procurementTotalsByCurrency([
      {
        currency: "EUR",
        licenseType: "perpetual",
        estimatedTotalPrice: "100.00",
        maintenanceCoverage: "included",
        maintenanceCost: "50.00",
      },
      { currency: "USD", estimatedTotalPrice: "200.00" },
    ])).toEqual({ EUR: 150, USD: 200 });
  });

  test("sorts matching currency groups by their canonical totals without combining currencies", () => {
    const lower = [{ currency: "EUR", estimatedTotalPrice: "100", maintenanceCoverage: "included", maintenanceCost: "25", licenseType: "perpetual" }];
    const higher = [{ currency: "EUR", estimatedTotalPrice: "100", maintenanceCoverage: "included", maintenanceCost: "50", licenseType: "perpetual" }];
    const mixed = [...higher, { currency: "USD", estimatedTotalPrice: "1" }];

    expect(compareProcurementTotals(lower, higher)).toBeLessThan(0);
    expect(compareProcurementTotals(lower, higher, "desc")).toBeGreaterThan(0);
    expect(compareProcurementTotals(higher, mixed)).toBeLessThan(0);
    expect(compareProcurementTotals([], higher, "desc")).toBeGreaterThan(0);
  });
});

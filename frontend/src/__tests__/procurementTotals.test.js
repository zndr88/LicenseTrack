import { describe, expect, test } from "vitest";
import { procurementLineTotal } from "../utils/procurementTotals.js";

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
});

import { describe, expect, test } from "vitest";

import {
  getProcurementFormVisibility,
  isProcurementFieldVisible,
} from "../utils/procurementFormVisibility.js";

describe("procurement form visibility", () => {
  test("hides fulfillment identifiers during sourcing", () => {
    expect(getProcurementFormVisibility("sourcing")).toEqual({
      purchaseDate: false,
      invoiceNumber: false,
      externalRef: false,
    });
  });

  test.each(["pending", "conversion", "license"])("shows fulfillment identifiers at the %s stage", (stage) => {
    expect(isProcurementFieldVisible(stage, "purchaseDate")).toBe(true);
    expect(isProcurementFieldVisible(stage, "invoiceNumber")).toBe(true);
    expect(isProcurementFieldVisible(stage, "externalRef")).toBe(true);
  });

  test("rejects unknown stages instead of silently choosing a visibility policy", () => {
    expect(() => isProcurementFieldVisible("unknown", "invoiceNumber")).toThrow("Unknown procurement stage");
  });
});

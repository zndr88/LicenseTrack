import { describe, expect, it } from "vitest";

import {
  getSourcingItemInitialTotal,
  sourcingItemToFormDefaults,
} from "../../utils/sourcingItemFormModel.js";

describe("sourcing item API-to-form normalization", () => {
  it("creates blank defaults without an API item", () => {
    expect(sourcingItemToFormDefaults(undefined, undefined)).toMatchObject({
      publisherName: "",
      licenseMetric: "per_user",
      maintenanceCoverage: "unknown",
      quantityPerUnit: "1",
      currency: "EUR",
      secondaryContacts: "",
      customFieldValues: {},
    });
  });

  it("preserves item values and formats form-only fields", () => {
    expect(sourcingItemToFormDefaults({
      publisherName: "Acme",
      secondaryContacts: ["one@example.com", "two@example.com"],
      customFieldValues: [{ customFieldDefId: 7, valueText: "Finance" }],
    }, {})).toMatchObject({
      publisherName: "Acme",
      secondaryContacts: "one@example.com, two@example.com",
      customFieldValues: { 7: "Finance" },
    });
  });

  it("falls back to request-level supplier details when line values are blank", () => {
    expect(sourcingItemToFormDefaults(
      { supplier: null, contactEmail: "" },
      { supplier: "Reseller", contactEmail: "sales@example.com" },
    )).toMatchObject({ supplier: "Reseller", contactEmail: "sales@example.com" });
  });

  it("applies renewal maintenance defaults", () => {
    expect(sourcingItemToFormDefaults({ isRenewal: true, licenseType: "subscription" }, {}))
      .toMatchObject({ maintenanceCoverage: "included" });
  });

  it("computes the initial total and otherwise preserves the supplied total", () => {
    expect(getSourcingItemInitialTotal({ quantity: "2", estimatedUnitPrice: "12.50" })).toBe("25.00");
    expect(getSourcingItemInitialTotal({ quantity: "", estimatedTotalPrice: "30.00" })).toBe("30.00");
  });
});

import { describe, expect, it } from "vitest";

import { createLicenseDraftSupplementDefaults } from "../../utils/licenseFormDefaults.js";

describe("license form defaults", () => {
  it("provides the canonical defaults for supplemental license fields", () => {
    expect(createLicenseDraftSupplementDefaults()).toMatchObject({
      licenseType: "",
      licenseMetric: "per_user",
      quantityPerUnit: "1",
      maintenanceCoverage: "unknown",
      maintenancePricingBasis: "flat",
      customFieldValues: {},
    });
  });

  it("returns independent custom-field maps for each form draft", () => {
    const first = createLicenseDraftSupplementDefaults();
    const second = createLicenseDraftSupplementDefaults();

    first.customFieldValues.owner = "Finance";

    expect(second.customFieldValues).toEqual({});
  });
});

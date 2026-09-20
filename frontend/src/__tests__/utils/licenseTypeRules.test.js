import { describe, expect, test } from "vitest";

import { isNonExpiringLicenseType, suppressEndDateForType } from "../../utils/licenseTypeRules.js";

describe("licenseTypeRules", () => {
  test("non-expiring types are recognised", () => {
    expect(isNonExpiringLicenseType("perpetual")).toBe(true);
    expect(isNonExpiringLicenseType("oem")).toBe(true);
    expect(isNonExpiringLicenseType("freeware")).toBe(true);
    expect(isNonExpiringLicenseType("service")).toBe(true);
    expect(isNonExpiringLicenseType("other")).toBe(true);
    expect(isNonExpiringLicenseType("subscription")).toBe(false);
    expect(isNonExpiringLicenseType("saas")).toBe(false);
    expect(isNonExpiringLicenseType("")).toBe(false);
    expect(isNonExpiringLicenseType(undefined)).toBe(false);
  });

  test("suppressEndDateForType clears end date only for non-expiring types", () => {
    expect(suppressEndDateForType({ licenseType: "perpetual", endDate: "2030-01-01" }))
      .toEqual({ licenseType: "perpetual", endDate: "" });
    expect(suppressEndDateForType({ licenseType: "subscription", endDate: "2030-01-01" }))
      .toEqual({ licenseType: "subscription", endDate: "2030-01-01" });
  });

  test("suppressEndDateForType preserves other fields", () => {
    expect(suppressEndDateForType({ licenseType: "oem", endDate: "2030-01-01", quantity: "5" }))
      .toEqual({ licenseType: "oem", endDate: "", quantity: "5" });
  });
});

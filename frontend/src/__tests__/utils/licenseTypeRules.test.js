import { describe, expect, test } from "vitest";

import {
  isNonExpiringLicenseType,
  isRenewableLicense,
  renewableLabel,
  suppressEndDateForType,
  typeDescriptionMissing,
  typeOptInPayload,
} from "../../utils/licenseTypeRules.js";
import { isRenewalActionEligible } from "../../utils/renewalBundle.js";
import { getBudgetForecast } from "../../utils/reportHelpers.js";

describe("licenseTypeRules", () => {
  test("non-expiring types are recognised", () => {
    expect(isNonExpiringLicenseType("perpetual")).toBe(true);
    expect(isNonExpiringLicenseType("oem")).toBe(true);
    expect(isNonExpiringLicenseType("freeware")).toBe(true);
    expect(isNonExpiringLicenseType("service")).toBe(false);
    expect(isNonExpiringLicenseType("other")).toBe(false);
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
    expect(suppressEndDateForType({ licenseType: "service", endDate: "2030-01-01" }))
      .toEqual({ licenseType: "service", endDate: "2030-01-01" });
  });

  test("suppressEndDateForType preserves other fields", () => {
    expect(suppressEndDateForType({ licenseType: "oem", endDate: "2030-01-01", quantity: "5" }))
      .toEqual({ licenseType: "oem", endDate: "", quantity: "5" });
  });

  test("Service/Other renew only when marked renewable", () => {
    expect(isRenewableLicense({ licenseType: "subscription" })).toBe(true);
    expect(isRenewableLicense({ licenseType: "service" })).toBe(false);
    expect(isRenewableLicense({ licenseType: "other", isRenewable: false })).toBe(false);
    expect(isRenewableLicense({ licenseType: "other", isRenewable: true })).toBe(true);
    expect(renewableLabel({ licenseType: "service", isRenewable: true })).toBe("Yes");
    expect(renewableLabel({ licenseType: "service", isRenewable: null })).toBe("No");
    expect(renewableLabel({ licenseType: "saas" })).toBe("");
  });

  test("Other needs a type description; the payload clears fields a type does not use", () => {
    expect(typeDescriptionMissing("other", "  ")).toBe(true);
    expect(typeDescriptionMissing("other", "Voucher")).toBe(false);
    expect(typeDescriptionMissing("service", "")).toBe(false);
    expect(typeOptInPayload({ licenseType: "other", isRenewable: true, typeDescription: " Voucher " }))
      .toEqual({ isRenewable: true, typeDescription: "Voucher" });
    expect(typeOptInPayload({ licenseType: "service", isRenewable: false, typeDescription: "x" }))
      .toEqual({ isRenewable: false, typeDescription: null });
    expect(typeOptInPayload({ licenseType: "subscription", isRenewable: true, typeDescription: "x" }))
      .toEqual({ isRenewable: null, typeDescription: null });
  });

  test("renewal action eligibility and recurring cost follow renewability", () => {
    const today = "2026-09-23";
    const service = {
      id: 1,
      licenseType: "service",
      startDate: "2025-10-01",
      endDate: "2026-10-01",
      daysUntilExpiry: 8,
      quantity: "1",
      unitPrice: "1200",
      currency: "EUR",
    };

    expect(isRenewalActionEligible(service, 30, today)).toBe(false);
    expect(isRenewalActionEligible({ ...service, isRenewable: true }, 30, today)).toBe(true);
    expect(getBudgetForecast([service]).recurringRecords).toHaveLength(0);
    expect(getBudgetForecast([{ ...service, isRenewable: true }]).recurringRecords).toHaveLength(1);
  });
});

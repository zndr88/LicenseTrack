import { describe, expect, it } from "vitest";

import {
  getSourcingItemInitialTotal,
  maintenanceCompanionToPayload,
  sourcingAdditionalLineToPayload,
  sourcingEditFormToPayload,
  sourcingItemToFormDefaults,
  sourcingPrimaryFormToPayload,
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

describe("sourcing item form-to-API normalization", () => {
  const settings = { numberFormatLocale: "de-DE" };
  const customFieldDefs = [{ id: 7, fieldType: "currency" }];

  it("normalizes the primary create line and clears inapplicable fields", () => {
    expect(sourcingPrimaryFormToPayload({
      publisherName: "Acme",
      softwareDescription: "Suite",
      licenseType: "freeware",
      licenseMetric: "per_user",
      portalUrl: "https://stale.example",
      maintenanceCoverage: "included",
      quantity: "1.234,5",
      quantityPerUnit: "",
      estimatedUnitPrice: "25,00",
      estimatedTotalPrice: "50,00",
      secondaryContacts: "one@example.com; two@example.com",
      customFieldValues: { 7: "12,50" },
    }, customFieldDefs, settings)).toMatchObject({
      licenseType: "freeware",
      portalUrl: null,
      maintenanceCoverage: "included",
      maintenanceStartDate: null,
      quantity: "1234.5",
      quantityPerUnit: "1",
      estimatedUnitPrice: null,
      estimatedTotalPrice: null,
      currency: "EUR",
      secondaryContacts: ["one@example.com", "two@example.com"],
      customFieldValues: [{ customFieldDefId: 7, valueCurrency: "12.50" }],
    });
  });

  it("normalizes additional-line commercial and request fields", () => {
    expect(sourcingAdditionalLineToPayload({
      publisherName: "Acme",
      softwareDescription: "Suite",
      licenseType: "saas",
      portalUrl: "https://portal.example",
      quantity: "2,5",
      quantityPerUnit: "1",
      estimatedUnitPrice: "10,00",
      estimatedTotalPrice: "25,00",
      secondaryContacts: "owner@example.com",
      customFieldValues: {},
      parentItemIndex: 0,
    }, [], settings)).toMatchObject({
      portalUrl: "https://portal.example",
      quantity: "2.5",
      estimatedTotalPrice: "25.00",
      secondaryContacts: ["owner@example.com"],
      parentItemIndex: 0,
    });
  });

  it("preserves edit fields while normalizing API-specific values", () => {
    expect(sourcingEditFormToPayload({
      id: 42,
      licenseType: "subscription",
      quantity: "2,5",
      estimatedUnitPrice: "10,00",
      estimatedTotalPrice: "25,00",
      maintenanceQuantity: "1,5",
      maintenanceUnitPrice: "2,00",
      maintenanceCost: "3,00",
      secondaryContacts: "owner@example.com",
      customFieldValues: {},
    }, [], settings)).toMatchObject({
      id: 42,
      quantity: "2.5",
      estimatedUnitPrice: "10.00",
      estimatedTotalPrice: "25.00",
      maintenanceQuantity: "1.5",
      maintenanceUnitPrice: "2.00",
      maintenanceCost: "3.00",
      secondaryContacts: ["owner@example.com"],
    });
  });

  it("builds maintenance companion payloads with the parent identity", () => {
    expect(maintenanceCompanionToPayload({
      publisherName: "Acme",
      softwareDescription: "Support",
      quantity: "1",
      estimatedUnitPrice: "12,50",
      estimatedTotalPrice: "12,50",
      currency: "EUR",
    }, 42, settings)).toMatchObject({
      licenseType: "maintenance",
      parentSourcingItemId: 42,
      estimatedUnitPrice: "12.50",
      estimatedTotalPrice: "12.50",
    });
  });
});

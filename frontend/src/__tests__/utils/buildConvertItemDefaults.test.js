import { describe, it, expect } from "vitest";
import { buildConvertItemDefaults } from "../../utils/buildConvertItemDefaults.js";

const baseOrder = { poNumber: "PO-001", supplier: "Default Supplier", items: [] };

const makeSI = (overrides = {}) => ({
  id: 1,
  publisherName: "Adobe",
  softwareDescription: "Creative Cloud",
  isRenewal: false,
  renewalForLicenseId: null,
  quantity: "10",
  estimatedUnitPrice: "50.00",
  estimatedTotalPrice: "500.00",
  currency: "EUR",
  ...overrides,
});

const makeLicense = (overrides = {}) => ({
  id: 42,
  publisherName: "Legacy Adobe",
  softwareDescription: "Legacy Creative Cloud",
  contractNumber: "C-42",
  contactEmail: "mgr@acme.com",
  supplier: "CDW",
  costCentre: "IT",
  licenseType: "saas",
  licenseMetric: "per_user",
  portalUrl: "https://adobe.com/admin",
  quantity: "10",
  skuCode: "AAAA-1234",
  unitPrice: "49.00",
  totalPoPrice: "490.00",
  currency: "EUR",
  budgetOwnerEmail: "budget@acme.com",
  notes: "Renew through reseller.",
  ...overrides,
});

describe("buildConvertItemDefaults", () => {
  it("returns one entry per order item", () => {
    const order = { ...baseOrder, items: [makeSI({ id: 1 }), makeSI({ id: 2 })] };
    expect(buildConvertItemDefaults(order, [])).toHaveLength(2);
  });

  it("always uses the PO poNumber", () => {
    const order = { ...baseOrder, items: [makeSI()] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.poNumber).toBe("PO-001");
  });

  it("falls back to order supplier when item has no renewal", () => {
    const order = { ...baseOrder, items: [makeSI()] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.supplier).toBe("Default Supplier");
  });

  it("inherits renewal license fields when isRenewal=true and license is found", () => {
    const si = makeSI({ isRenewal: true, renewalForLicenseId: 42 });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [makeLicense()]);
    expect(d.contractNumber).toBe("C-42");
    expect(d.supplier).toBe("Default Supplier");
    expect(d.licenseType).toBe("saas");
    expect(d.portalUrl).toBe("https://adobe.com/admin");
  });

  it("prefers sourcing item estimatedUnitPrice over renewal license unitPrice", () => {
    const si = makeSI({
      isRenewal: true,
      renewalForLicenseId: 42,
      quantity: "12",
      estimatedUnitPrice: "55.00",
      estimatedTotalPrice: "660.00",
      startDate: "2026-03-01",
      endDate: "2027-02-28",
      supplier: "Current Line Supplier",
      contactEmail: "current-line@example.com",
      currency: "USD",
    });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [makeLicense()]);
    expect(d.quantity).toBe("12");
    expect(d.unitPrice).toBe("55.00");
    expect(d.totalPoPrice).toBe("660.00");
    expect(d.startDate).toBe("2026-03-01");
    expect(d.endDate).toBe("2027-02-28");
    expect(d.supplier).toBe("Default Supplier");
    expect(d.contactEmail).toBe("current-line@example.com");
    expect(d.currency).toBe("USD");
  });

  it("uses line publisher and description before predecessor fallbacks", () => {
    const order = {
      ...baseOrder,
      items: [makeSI({ isRenewal: true, renewalForLicenseId: 42 })],
    };
    const [current] = buildConvertItemDefaults(order, [makeLicense()]);
    expect(current.publisherName).toBe("Adobe");
    expect(current.softwareDescription).toBe("Creative Cloud");

    const fallbackOrder = {
      ...baseOrder,
      items: [makeSI({
        isRenewal: true,
        renewalForLicenseId: 42,
        publisherName: "",
        softwareDescription: "",
      })],
    };
    const [fallback] = buildConvertItemDefaults(fallbackOrder, [makeLicense()]);
    expect(fallback.publisherName).toBe("Legacy Adobe");
    expect(fallback.softwareDescription).toBe("Legacy Creative Cloud");
  });

  it("uses PO supplier, then line supplier, then predecessor supplier", () => {
    const predecessor = makeLicense({ supplier: "Previous Supplier" });
    const lineOrder = {
      ...baseOrder,
      supplier: "PO Supplier",
      items: [makeSI({
        isRenewal: true,
        renewalForLicenseId: 42,
        supplier: "Line Supplier",
      })],
    };
    expect(buildConvertItemDefaults(lineOrder, [predecessor])[0].supplier).toBe("PO Supplier");

    const poOrder = {
      ...lineOrder,
      items: [{ ...lineOrder.items[0], supplier: "" }],
    };
    expect(buildConvertItemDefaults(poOrder, [predecessor])[0].supplier).toBe("PO Supplier");

    const predecessorOrder = { ...poOrder, supplier: "" };
    expect(buildConvertItemDefaults(predecessorOrder, [predecessor])[0].supplier).toBe(
      "Previous Supplier"
    );
  });

  it("defaults licenseType to 'subscription' when no renewal", () => {
    const order = { ...baseOrder, items: [makeSI()] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.licenseType).toBe("subscription");
  });

  it.each(["subscription", "saas"])(
    "inherits %s as the renewal license type without re-entry",
    (licenseType) => {
      const si = makeSI({
        isRenewal: true,
        renewalForLicenseId: 42,
        licenseType: undefined,
      });
      const order = { ...baseOrder, items: [si] };
      const [d] = buildConvertItemDefaults(order, [makeLicense({ licenseType })]);
      expect(d.licenseType).toBe(licenseType);
    }
  );

  it("prefers the current line license type over its predecessor", () => {
    const si = makeSI({
      isRenewal: true,
      renewalForLicenseId: 42,
      licenseType: "subscription",
    });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [makeLicense({ licenseType: "saas" })]);
    expect(d.licenseType).toBe("subscription");
  });

  it("defaults currency to 'EUR' when sourcing item has no currency and no renewal", () => {
    const si = makeSI({ currency: undefined });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.currency).toBe("EUR");
  });

  it("uses the configured currency as the final fallback", () => {
    const si = makeSI({ currency: undefined });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [], "GBP");
    expect(d.currency).toBe("GBP");
  });

  it("preserves PO and line-item notes with clear labels", () => {
    const si = makeSI({ notes: "Provision the design team first." });
    const order = { ...baseOrder, notes: "Requested by Marketing.", items: [si] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.notes).toBe(
      "Purchase order notes:\nRequested by Marketing.\n\n" +
      "Line item notes:\nProvision the design team first."
    );
  });

  it("does not repeat identical notes from different procurement levels", () => {
    const si = makeSI({ notes: "Keep the signed quote." });
    const order = { ...baseOrder, notes: "Keep the signed quote.", items: [si] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.notes).toBe("Purchase order notes:\nKeep the signed quote.");
  });

  it("preserves the previous license note when preparing a renewal", () => {
    const si = makeSI({ isRenewal: true, renewalForLicenseId: 42 });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [makeLicense()]);
    expect(d.notes).toBe("Previous license notes:\nRenew through reseller.");
  });

  it("combines distinct PO, line, and predecessor notes and deduplicates repeats", () => {
    const si = makeSI({
      isRenewal: true,
      renewalForLicenseId: 42,
      notes: "Line approval.",
    });
    const order = {
      ...baseOrder,
      notes: "PO approval.",
      items: [si],
    };
    const [d] = buildConvertItemDefaults(order, [
      makeLicense({ notes: "Previous approval." }),
    ]);
    expect(d.notes).toBe(
      "Purchase order notes:\nPO approval.\n\n" +
      "Line item notes:\nLine approval.\n\n" +
      "Previous license notes:\nPrevious approval."
    );

    const repeatedOrder = {
      ...order,
      items: [{ ...si, notes: "PO approval." }],
    };
    const [deduplicated] = buildConvertItemDefaults(repeatedOrder, [
      makeLicense({ notes: "PO approval." }),
    ]);
    expect(deduplicated.notes).toBe("Purchase order notes:\nPO approval.");
  });

  it("returns empty array when order has no items", () => {
    expect(buildConvertItemDefaults(baseOrder, [])).toEqual([]);
  });

  it("carries the sourcing item's start and end dates into the convert form", () => {
    const si = makeSI({ startDate: "2026-03-01", endDate: "2027-02-28" });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.startDate).toBe("2026-03-01");
    expect(d.endDate).toBe("2027-02-28");
  });

  it("defaults dates to empty strings when the sourcing item has none", () => {
    const order = { ...baseOrder, items: [makeSI()] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.startDate).toBe("");
    expect(d.endDate).toBe("");
  });

  it("uses the coterm primary predecessor selected by renewalForLicenseId", () => {
    const si = makeSI({
      isRenewal: true,
      renewalForLicenseId: 42,
      cotermPredecessorIds: [42, 7],
      licenseType: undefined,
    });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [
      makeLicense({ id: 7, licenseType: "subscription", contractNumber: "SECONDARY" }),
      makeLicense({ id: 42, licenseType: "saas", contractNumber: "PRIMARY" }),
    ]);
    expect(d.licenseType).toBe("saas");
    expect(d.contractNumber).toBe("PRIMARY");
  });

  it("preserves maintenance renewal defaults and its existing parent", () => {
    const si = makeSI({
      isRenewal: true,
      renewalForLicenseId: 42,
      licenseType: "maintenance",
      maintenanceCoverage: "included",
      maintenanceStartDate: "2026-01-01",
      maintenanceEndDate: "2026-12-31",
      maintenancePricingBasis: "per_unit",
      maintenanceQuantity: "25",
      maintenanceUnitPrice: "8.00",
      maintenanceCost: "200.00",
    });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [
      makeLicense({
        licenseType: "maintenance",
        parentLicenseId: 77,
        maintenanceCoverage: "unknown",
      }),
    ]);
    expect(d).toEqual(expect.objectContaining({
      licenseType: "maintenance",
      parentLicenseId: 77,
      parentSourcingItemId: "",
      maintenanceCoverage: "included",
      maintenanceStartDate: "2026-01-01",
      maintenanceEndDate: "2026-12-31",
      maintenancePricingBasis: "per_unit",
      maintenanceQuantity: "25",
      maintenanceUnitPrice: "8.00",
      maintenanceCost: "200.00",
    }));
  });
});

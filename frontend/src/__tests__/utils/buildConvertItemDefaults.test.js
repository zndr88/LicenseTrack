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
    expect(d.supplier).toBe("CDW");
    expect(d.licenseType).toBe("saas");
    expect(d.portalUrl).toBe("https://adobe.com/admin");
  });

  it("prefers sourcing item estimatedUnitPrice over renewal license unitPrice", () => {
    const si = makeSI({ isRenewal: true, renewalForLicenseId: 42, estimatedUnitPrice: "55.00" });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, [makeLicense()]);
    expect(d.unitPrice).toBe("55.00");
  });

  it("defaults licenseType to 'subscription' when no renewal", () => {
    const order = { ...baseOrder, items: [makeSI()] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.licenseType).toBe("subscription");
  });

  it("defaults currency to 'EUR' when sourcing item has no currency and no renewal", () => {
    const si = makeSI({ currency: undefined });
    const order = { ...baseOrder, items: [si] };
    const [d] = buildConvertItemDefaults(order, []);
    expect(d.currency).toBe("EUR");
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
    const [d] = buildConvertItemDefaults(order, [makeLicense({ notes: "Renew through reseller." })]);
    expect(d.notes).toBe("Previous license notes:\nRenew through reseller.");
  });

  it("returns empty array when order has no items", () => {
    expect(buildConvertItemDefaults(baseOrder, [])).toEqual([]);
  });
});

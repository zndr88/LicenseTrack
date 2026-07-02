import { describe, expect, it } from "vitest";
import { getCompleteness, normalizeLicense } from "../utils/helpers.js";

describe("getCompleteness", () => {
  it("counts the new record-level completeness requirements", () => {
    const result = getCompleteness(
      {
        costCentre: "Finance",
        budgetOwnerEmail: "owner@example.com",
        invoiceNumber: "INV-100",
      },
      { costCentre: true, budgetOwnerEmail: true, invoiceNumber: true },
    );

    expect(result.percentage).toBe(100);
    expect(result.isComplete).toBe(true);
  });

  it("counts purchase order and quote documents", () => {
    const result = getCompleteness(
      { documents: { purchase_order: [{}], quote: [{}] } },
      { purchaseOrder: true, quote: true },
    );

    expect(result.percentage).toBe(100);
    expect(result.isComplete).toBe(true);
  });
});

describe("normalizeLicense", () => {
  it("provides empty arrays for procurement evidence documents", () => {
    expect(normalizeLicense({}).documents).toMatchObject({
      purchase_order: [],
      quote: [],
    });
  });

  it("defaults maintenance coverage by license type", () => {
    expect(normalizeLicense({ licenseType: "subscription" }).maintenanceCoverage).toBe("included");
    expect(normalizeLicense({ licenseType: "saas" }).maintenanceCoverage).toBe("included");
    expect(normalizeLicense({ licenseType: "perpetual" }).maintenanceCoverage).toBe("unknown");
    expect(normalizeLicense({ licenseType: "oem" }).maintenanceCoverage).toBe("unknown");
    expect(normalizeLicense({ licenseType: "freeware" }).maintenanceCoverage).toBe("unknown");
    expect(normalizeLicense({ licenseType: "maintenance" }).maintenanceCoverage).toBe("not_applicable");
  });
});

describe("getCompleteness end date", () => {
  it("accepts non-expiring types without an end date", () => {
    for (const licenseType of ["perpetual", "oem", "freeware"]) {
      expect(getCompleteness({ licenseType }, { endDate: true }).percentage).toBe(100);
    }
  });

  it("still requires recurring types to have an end date", () => {
    for (const licenseType of ["subscription", "saas", "maintenance"]) {
      expect(getCompleteness({ licenseType }, { endDate: true }).percentage).toBe(0);
    }
  });
});

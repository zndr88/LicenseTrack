import { describe, expect, it } from "vitest";
import { getCompleteness, getExpirationStatus, getPoTotal, normalizeLicense } from "../utils/helpers.js";

describe("getPoTotal", () => {
  it("uses a shared PO override before calculated line totals", () => {
    const licenses = [
      { poNumber: "PO-1", currency: "EUR", quantity: "10", unitPrice: "0", poTotalOverride: "1250.00", retired: false },
      { poNumber: "PO-1", currency: "EUR", quantity: "5", unitPrice: "0", retired: false },
    ];

    expect(getPoTotal("PO-1", "EUR", licenses)).toBe(1250);
  });

  it("returns to calculated line totals after the override is cleared", () => {
    const licenses = [
      { poNumber: "PO-1", currency: "EUR", quantity: "10", unitPrice: "12.50", poTotalOverride: null, retired: false },
      { poNumber: "PO-1", currency: "EUR", quantity: "5", unitPrice: "10", poTotalOverride: null, retired: false },
    ];

    expect(getPoTotal("PO-1", "EUR", licenses)).toBe(175);
  });

  it("keeps reused PO numbers separated by currency", () => {
    const licenses = [
      { poNumber: "PO-1", currency: "EUR", quantity: "1", unitPrice: "100", retired: false },
      { poNumber: "PO-1", currency: "USD", quantity: "1", unitPrice: "200", retired: false },
    ];

    expect(getPoTotal("PO-1", "EUR", licenses)).toBe(100);
    expect(getPoTotal("PO-1", "USD", licenses)).toBe(200);
  });
});

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

  it("excludes inapplicable requirements from freeware records", () => {
    const result = getCompleteness(
      {
        licenseType: "freeware",
        costCentre: "Finance",
        documents: {},
      },
      {
        invoice: true,
        invoiceNumber: true,
        contractNumber: true,
        poNumber: true,
        purchaseOrder: true,
        quote: true,
        costCentre: true,
        budgetOwnerEmail: true,
        eula: true,
        entitlement: true,
        contactEmail: true,
      },
    );

    expect(result.percentage).toBe(50);
    expect(result.checks.map((check) => check.field)).toEqual([
      "Department / Cost Centre",
      "Budget owner email",
    ]);
  });

  it("excludes entitlement document requirements from service and other records", () => {
    for (const licenseType of ["service", "other"]) {
      const result = getCompleteness(
        {
          licenseType,
          contractNumber: "CTR-100",
          documents: {},
        },
        {
          contractNumber: true,
          eula: true,
          entitlement: true,
        },
      );

      expect(result.percentage).toBe(100);
      expect(result.checks.map((check) => check.field)).toEqual(["Contract number"]);
    }
  });

  it("restores purchase evidence checks for freeware with paid included support", () => {
    const result = getCompleteness(
      {
        licenseType: "freeware",
        maintenanceCoverage: "included",
        maintenanceCost: "2500",
        documents: {},
      },
      {
        poNumber: true,
        invoice: true,
        eula: true,
        entitlement: true,
        contactEmail: true,
      },
    );

    expect(result.checks.map((check) => check.field)).toEqual([
      "Invoice document",
      "PO number",
    ]);
    expect(result.percentage).toBe(0);
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
    expect(normalizeLicense({ licenseType: "service" }).maintenanceCoverage).toBe("not_applicable");
    expect(normalizeLicense({ licenseType: "other" }).maintenanceCoverage).toBe("not_applicable");
  });
});

describe("getCompleteness end date", () => {
  it("accepts non-expiring types without an end date", () => {
    for (const licenseType of ["perpetual", "oem", "freeware", "service", "other"]) {
      expect(getCompleteness({ licenseType }, { endDate: true }).percentage).toBe(100);
    }
  });

  it("still requires recurring types to have an end date", () => {
    for (const licenseType of ["subscription", "saas", "maintenance"]) {
      expect(getCompleteness({ licenseType }, { endDate: true }).percentage).toBe(0);
    }
  });
});

describe("getExpirationStatus without an end date", () => {
  it("only labels non-expiring license types as perpetual", () => {
    expect(getExpirationStatus(null, 30, false, null, null, null, "perpetual").status).toBe("perpetual");
    expect(getExpirationStatus(null, 30, false, null, null, null, "subscription")).toEqual({
      status: "active",
      days: null,
      label: "Active",
    });
  });
});

describe("getExpirationStatus with a linked successor", () => {
  test("keeps the predecessor expiring until its own end date", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(getExpirationStatus(
      tomorrow.toISOString().slice(0, 10),
      30,
      false,
      "renewed",
      2,
    ).status).toBe("expiring");
  });

  test("keeps a coverage gap expired until the successor starts", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(getExpirationStatus(
      yesterday.toISOString().slice(0, 10),
      30,
      false,
      "renewed",
      2,
      null,
      "subscription",
      tomorrow.toISOString().slice(0, 10),
    ).status).toBe("expired");
  });
});

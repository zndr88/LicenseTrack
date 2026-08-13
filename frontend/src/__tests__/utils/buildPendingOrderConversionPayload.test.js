import { describe, expect, it } from "vitest";
import { buildPendingOrderConversionPayload } from "../../components/procurement/buildPendingOrderConversionPayload.js";

const BASE = {
  publisherName: "Acme",
  softwareDescription: "Widget",
  startDate: "",
  endDate: "",
  contractNumber: "",
  poNumber: "",
  procurementReference: "",
  invoiceNumber: "",
  contactEmail: "",
  supplier: "",
  costCentre: "",
  licenseType: "subscription",
  licenseMetric: "per_user",
  portalUrl: "",
  parentLicenseId: "",
  quantity: "1.000",
  quantityPerUnit: "5.000.000",
  skuCode: "",
  unitPrice: "1.234,50",
  totalPoPrice: "1.234.500,00",
  currency: "EUR",
  budgetOwnerEmail: "",
  notes: "",
};

describe("buildPendingOrderConversionPayload", () => {
  it("canonicalizes Belgian quantity and prices", () => {
    const payload = buildPendingOrderConversionPayload(BASE, { numberFormatLocale: "nl-BE" });

    expect(payload.quantity).toBe("1000");
    expect(payload.quantityPerUnit).toBe("5000000");
    expect(payload.unitPrice).toBe("1234.50");
    expect(payload.totalPoPrice).toBe("1234500.00");
  });
});

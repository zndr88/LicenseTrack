import { describe, it, expect } from "vitest";
import { isItemReady } from "../../components/procurement/ConvertItemForm.jsx";

// isItemReady is a pure function — test without rendering
describe("isItemReady", () => {
  const base = {
    publisherName: "Adobe",
    softwareDescription: "CC",
    startDate: "2025-01-01",
    isPerpetual: false,
    endDate: "2025-12-31",
    quantity: "10",
    unitPrice: "50",
  };

  it("returns true when all required fields are present", () => {
    expect(isItemReady(base)).toBe(true);
  });

  it("returns false when publisherName is empty", () => {
    expect(isItemReady({ ...base, publisherName: "" })).toBe(false);
  });

  it("returns false when publisherName is whitespace only", () => {
    expect(isItemReady({ ...base, publisherName: "   " })).toBe(false);
  });

  it("returns false when softwareDescription is empty", () => {
    expect(isItemReady({ ...base, softwareDescription: "  " })).toBe(false);
  });

  it("returns false when startDate is empty", () => {
    expect(isItemReady({ ...base, startDate: "" })).toBe(false);
  });

  it("returns false when not perpetual and endDate is empty", () => {
    expect(isItemReady({ ...base, isPerpetual: false, endDate: "" })).toBe(false);
  });

  it("returns true when isPerpetual=true even without endDate", () => {
    expect(isItemReady({ ...base, isPerpetual: true, endDate: "" })).toBe(true);
  });

  it("returns false when quantity is empty string", () => {
    expect(isItemReady({ ...base, quantity: "" })).toBe(false);
  });

  it("returns false when unitPrice is empty string", () => {
    expect(isItemReady({ ...base, unitPrice: "" })).toBe(false);
  });

  it("returns false for null/undefined item", () => {
    expect(isItemReady(null)).toBe(false);
    expect(isItemReady(undefined)).toBe(false);
  });
});

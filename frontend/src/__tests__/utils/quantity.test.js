import { describe, expect, it } from "vitest";
import {
  canonicalizePositiveQuantityInput,
  canonicalizeQuantityInput,
  formatQuantity,
  formatQuantityInput,
  normalizeCanonicalQuantity,
  sumCanonicalQuantities,
} from "../../utils/quantity.js";

describe("quantity utilities", () => {
  const enUS = { numberFormatLocale: "en-US" };
  const deDE = { numberFormatLocale: "de-DE" };

  it("adds canonical fractional quantities without binary-float drift", () => {
    expect(sumCanonicalQuantities(["1.25", "2.5"])).toBe("3.75");
    expect(sumCanonicalQuantities(["0.1", "0.2"])).toBe("0.3");
  });

  it("keeps integer sums and displays integer quantities without a decimal suffix", () => {
    expect(sumCanonicalQuantities(["2", "3"])).toBe("5");
    expect(formatQuantity("5.000", enUS)).toBe("5");
  });

  it("canonicalizes and displays comma-decimal quantities", () => {
    expect(canonicalizeQuantityInput("3,750", deDE)).toBe("3.75");
    expect(formatQuantity("3.75", deDE)).toBe("3,75");
  });

  it("preserves the exact value of a canonicalized fractional override", () => {
    expect(canonicalizePositiveQuantityInput("4.1250", enUS)).toBe("4.125");
    expect(canonicalizePositiveQuantityInput("4,1250", deDE)).toBe("4.125");
  });

  it.each(["", "invalid", "0", "0.0", "-1", "-0.25"])(
    "rejects non-positive or invalid final quantity %j",
    (value) => {
      expect(canonicalizePositiveQuantityInput(value, enUS)).toBeNull();
    }
  );

  it("rejects invalid canonical inputs instead of treating them as zero", () => {
    expect(normalizeCanonicalQuantity("seats")).toBeNull();
    expect(sumCanonicalQuantities(["1.25", "seats"])).toBeNull();
  });
});

describe("formatQuantityInput (#63)", () => {
  const nlBE = { numberFormatLocale: "nl-BE" };

  it("starts editable text from a value that reads back unchanged under D1", () => {
    for (const value of ["1000", "1500", "2.5", "1234567", "0.125", "3"]) {
      expect(canonicalizeQuantityInput(formatQuantityInput(value, nlBE), nlBE)).toBe(value);
    }
  });

  it("shows the user's format without a lone dot group", () => {
    expect(formatQuantityInput("1000", nlBE)).toBe("1000");
    expect(formatQuantityInput("2.5", nlBE)).toBe("2,5");
    expect(formatQuantityInput("1234567", nlBE)).toBe("1.234.567");
    expect(formatQuantityInput("1.500", nlBE)).toBe("1,5");
    expect(formatQuantityInput("1500", { numberFormatLocale: "en-US" })).toBe("1,500");
  });

  it("returns empty or unparseable input as text", () => {
    expect(formatQuantityInput(null, nlBE)).toBe("");
    expect(formatQuantityInput("", nlBE)).toBe("");
    expect(formatQuantityInput("abc", nlBE)).toBe("abc");
  });
});

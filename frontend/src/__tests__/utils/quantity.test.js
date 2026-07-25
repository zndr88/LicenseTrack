import { describe, expect, it } from "vitest";
import {
  canonicalizePositiveQuantityInput,
  canonicalizeQuantityInput,
  formatQuantity,
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

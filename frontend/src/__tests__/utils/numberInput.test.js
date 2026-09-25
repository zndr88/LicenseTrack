import { describe, expect, it } from "vitest";
import { parseTypedNumber, toInputText } from "../../utils/formatting.js";
import { formatPriceInput } from "../../utils/helpers.js";

const LOCALES = ["en-US", "en-GB", "nl-BE", "nl-NL", "de-DE", "fr-FR", "de-CH"];
const CANONICAL = ["0.125", "1.234", "12.345", "1234.5", "1234.567", "1000000.25", "3", "-0.5", "15.50"];
const s = (locale) => ({ numberFormatLocale: locale });

describe("parseTypedNumber", () => {
  it.each(LOCALES)("never changes a canonical value (%s)", (locale) => {
    for (const value of CANONICAL) {
      expect(parseTypedNumber(value, s(locale))).toBe(value);
    }
  });

  it.each(LOCALES)("is idempotent: parsing a parsed value changes nothing (%s)", (locale) => {
    for (const typed of ["0,125", "1.234,5", "1,234.5", "12 345,6", "2,5", "15,50", "1.234.567"]) {
      const once = parseTypedNumber(typed, s(locale));
      if (once === null) continue;
      expect(parseTypedNumber(once, s(locale))).toBe(once);
    }
  });

  it("reads comma-decimal input", () => {
    expect(parseTypedNumber("0,125", s("nl-BE"))).toBe("0.125");
    expect(parseTypedNumber("1.234,56", s("nl-BE"))).toBe("1234.56");
    expect(parseTypedNumber("1.234.567", s("de-DE"))).toBe("1234567");
  });

  it("reads a single dot as a decimal in comma-decimal locales (decision D1)", () => {
    expect(parseTypedNumber("1.234", s("nl-BE"))).toBe("1.234");
    expect(parseTypedNumber("0.125", s("de-DE"))).toBe("0.125");
  });

  it("keeps en-US grouping", () => {
    expect(parseTypedNumber("1,234", s("en-US"))).toBe("1234");
    expect(parseTypedNumber("1,234.50", s("en-US"))).toBe("1234.50");
  });

  it("rejects text that is not a number", () => {
    expect(parseTypedNumber("abc", s("nl-BE"))).toBeNull();
    expect(parseTypedNumber("", s("nl-BE"))).toBeNull();
    expect(parseTypedNumber(null, s("nl-BE"))).toBeNull();
  });
});

describe("toInputText", () => {
  it("formats canonical values in the user's locale without losing decimals", () => {
    expect(toInputText("0.125", s("nl-BE"))).toBe("0,125");
    expect(toInputText("1234.567", s("nl-BE"))).toBe("1.234,567");
    expect(toInputText("1234.567", s("en-US"))).toBe("1,234.567");
    expect(toInputText("3", s("de-DE"))).toBe("3");
    expect(toInputText("-0.5", s("nl-BE"))).toBe("-0,5");
  });

  it("pads to a minimum number of decimals when asked", () => {
    expect(toInputText("15.5", s("nl-BE"), { minFractionDigits: 2 })).toBe("15,50");
    expect(toInputText("0.125", s("nl-BE"), { minFractionDigits: 2 })).toBe("0,125");
  });

  it("returns non-canonical text unchanged", () => {
    expect(toInputText("1,5", s("nl-BE"))).toBe("1,5");
    expect(toInputText("", s("nl-BE"))).toBe("");
    expect(toInputText(null, s("nl-BE"))).toBe("");
  });

  it.each(LOCALES)("round-trips every canonical value (%s)", (locale) => {
    for (const value of CANONICAL) {
      expect(parseTypedNumber(toInputText(value, s(locale)), s(locale))).toBe(value);
    }
  });
});

describe("formatPriceInput", () => {
  it("keeps three decimals instead of rounding", () => {
    expect(formatPriceInput("0.125", "nl-BE")).toBe("0,125");
  });
  it("pads to two decimals", () => {
    expect(formatPriceInput("1234.5", "en-US")).toBe("1,234.50");
  });
  it("reformats typed localized text", () => {
    expect(formatPriceInput("1234,5", "nl-BE")).toBe("1.234,50");
  });
});

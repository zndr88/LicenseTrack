import { describe, expect, it } from "vitest";
import { parseTypedNumber, parseTypedNumberResult, toInputText } from "../../utils/formatting.js";
import { formatPriceInput } from "../../utils/helpers.js";

const LOCALES = ["en-US", "en-GB", "nl-BE", "nl-NL", "de-DE", "fr-FR", "de-CH"];
const CANONICAL = ["0.125", "1.234", "12.345", "1234.5", "1234.567", "1000000.25", "3", "-0.5", "15.50", "1000", "1234", "999999", "1234567"];
const s = (locale) => ({ numberFormatLocale: locale });

describe("parseTypedNumber", () => {
  // Under dot-grouping, comma-decimal formats, "1.234" could be a thousand or a
  // decimal, so it's rejected. Stored values are never re-read as typed text
  // (NumberInput shows them with toInputText, which round-trips).
  const AMBIGUOUS_IN = { "nl-BE": ["1.234", "12.345"], "nl-NL": ["1.234", "12.345"], "de-DE": ["1.234", "12.345"] };

  it.each(LOCALES)("keeps every unambiguous canonical value (%s)", (locale) => {
    for (const value of CANONICAL) {
      if ((AMBIGUOUS_IN[locale] ?? []).includes(value)) continue;
      expect(parseTypedNumber(value, s(locale))).toBe(value);
    }
  });

  it("rejects a single dot group as ambiguous in dot-grouping, comma-decimal formats", () => {
    for (const [locale, values] of Object.entries(AMBIGUOUS_IN)) {
      for (const value of values) {
        expect(parseTypedNumberResult(value, s(locale))).toEqual({ value: null, error: "ambiguous" });
      }
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

  it("reads a dot that can't be grouping as a decimal in comma-decimal formats", () => {
    expect(parseTypedNumber("1.5", s("nl-BE"))).toBe("1.5");
    expect(parseTypedNumber("0.125", s("de-DE"))).toBe("0.125");
    expect(parseTypedNumber("1234.567", s("de-DE"))).toBe("1234.567");
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

  it("leaves out a single dot group that would read back as a decimal (D1)", () => {
    expect(toInputText("1000", s("nl-BE"))).toBe("1000");
    expect(toInputText("1234", s("de-DE"))).toBe("1234");
    expect(toInputText("1234567", s("nl-BE"))).toBe("1.234.567");
    expect(toInputText("1234", s("en-US"))).toBe("1,234");
    expect(toInputText("1234", s("nl-BE"), { minFractionDigits: 2 })).toBe("1.234,00");
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
  it("never re-reads or rewrites typed text (issue #82)", () => {
    expect(formatPriceInput("2,443.00", "en-US")).toBe("2,443.00");
    expect(formatPriceInput("1234,5", "nl-BE")).toBe("1234,5");
  });
});

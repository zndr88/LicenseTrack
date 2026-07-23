import { describe, expect, it } from "vitest";

import {
  NUMBER_FORMAT_OPTIONS,
  normalizeNumberFormatOptionValue,
} from "../constants/numberFormats.js";

describe("number format options", () => {
  it("offers one neutral label for each supported separator pattern", () => {
    expect(NUMBER_FORMAT_OPTIONS).toEqual([
      {
        value: "en-US",
        label: "1,234.50",
      },
      {
        value: "de-DE",
        label: "1.234,50",
      },
      {
        value: "fr-FR",
        label: "1 234,50",
      },
    ]);
  });

  it("maps equivalent stored locales onto their selector pattern", () => {
    expect(normalizeNumberFormatOptionValue("en-GB")).toBe("en-US");
    expect(normalizeNumberFormatOptionValue("nl-BE")).toBe("de-DE");
    expect(normalizeNumberFormatOptionValue("fr-CH")).toBe("fr-FR");
    expect(normalizeNumberFormatOptionValue(undefined)).toBe("en-US");
  });
});

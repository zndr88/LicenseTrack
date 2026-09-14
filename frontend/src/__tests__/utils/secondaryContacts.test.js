import { describe, expect, it } from "vitest";

import { formatSecondaryContacts, parseSecondaryContacts } from "../../utils/secondaryContacts.js";

describe("secondary contact form normalization", () => {
  it("parses comma, semicolon, and newline-delimited contacts", () => {
    expect(parseSecondaryContacts("one@example.com, two@example.com;\nthree@example.com"))
      .toEqual(["one@example.com", "two@example.com", "three@example.com"]);
  });

  it("trims contacts and removes empty entries", () => {
    expect(parseSecondaryContacts(" one@example.com ,, ; two@example.com "))
      .toEqual(["one@example.com", "two@example.com"]);
  });

  it("normalizes empty values to an empty list", () => {
    expect(parseSecondaryContacts(null)).toEqual([]);
    expect(parseSecondaryContacts(undefined)).toEqual([]);
    expect(parseSecondaryContacts("")).toEqual([]);
  });

  it("formats API contact arrays for text inputs", () => {
    expect(formatSecondaryContacts(["one@example.com", "two@example.com"]))
      .toBe("one@example.com, two@example.com");
    expect(formatSecondaryContacts(null)).toBe("");
  });
  it("preserves formatted strings and remains idempotent", () => {
    const contacts = "one@example.com, two@example.com";
    expect(formatSecondaryContacts(contacts)).toBe(contacts);
    expect(formatSecondaryContacts("  one@example.com  ")).toBe("one@example.com");
    expect(formatSecondaryContacts(formatSecondaryContacts(["one@example.com", "two@example.com"])))
      .toBe(contacts);
  });

  it("ignores empty array entries and unsupported shapes", () => {
    expect(formatSecondaryContacts([null, "one@example.com", "", undefined])).toBe("one@example.com");
    for (const value of [undefined, null, "", {}, { email: "one@example.com" }, 123, true]) {
      expect(formatSecondaryContacts(value)).toBe("");
    }
  });
});

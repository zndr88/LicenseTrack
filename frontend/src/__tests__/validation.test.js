import { describe, expect, test } from "vitest";
import { allowedEmailDomain, parseIntegerInput } from "../utils/validation.js";

describe("allowedEmailDomain", () => {
  test("passes for a valid domain", () => {
    expect(allowedEmailDomain("company.com")).toBeNull();
  });

  test("strips leading @ before validating", () => {
    expect(allowedEmailDomain("@company.com")).toBeNull();
  });

  test("fails for empty input", () => {
    expect(allowedEmailDomain("")).not.toBeNull();
    expect(allowedEmailDomain("   ")).not.toBeNull();
  });

  test("fails for domain without a dot", () => {
    expect(allowedEmailDomain("nodot")).not.toBeNull();
  });

  test("fails for domain with spaces", () => {
    expect(allowedEmailDomain("com pany.com")).not.toBeNull();
  });

  test("fails for value containing an extra @", () => {
    expect(allowedEmailDomain("user@company.com")).not.toBeNull();
  });
});

describe("parseIntegerInput", () => {
  test("converts integer strings, including zero", () => {
    expect(parseIntegerInput("0")).toBe(0);
    expect(parseIntegerInput("23")).toBe(23);
  });

  test("preserves an empty input", () => {
    expect(parseIntegerInput("")).toBe("");
  });

  test("leaves non-integer input for schema validation", () => {
    expect(parseIntegerInput("2.5")).toBe("2.5");
    expect(parseIntegerInput("invalid")).toBe("invalid");
  });
});

import { describe, expect, test } from "vitest";
import {
  requiredString,
  optionalEmail,
  requiredEmail,
  allowedEmailDomain,
  httpsUrl,
  hourRange,
  keepRange,
  senderAddress,
} from "../utils/validation.js";

describe("requiredString", () => {
  test("passes for a non-empty string", () => {
    expect(requiredString("hello")).toBeNull();
  });

  test("fails for empty string", () => {
    expect(requiredString("")).not.toBeNull();
  });

  test("fails for whitespace-only string", () => {
    expect(requiredString("   ")).not.toBeNull();
  });

  test("fails for null/undefined", () => {
    expect(requiredString(null)).not.toBeNull();
    expect(requiredString(undefined)).not.toBeNull();
  });

  test("uses fieldName in error message", () => {
    expect(requiredString("", "Client ID")).toMatch(/Client ID/);
  });
});

describe("optionalEmail", () => {
  test("passes for empty string", () => {
    expect(optionalEmail("")).toBeNull();
  });

  test("passes for null/undefined", () => {
    expect(optionalEmail(null)).toBeNull();
    expect(optionalEmail(undefined)).toBeNull();
  });

  test("passes for valid email", () => {
    expect(optionalEmail("manager@company.com")).toBeNull();
  });

  test("fails for obviously invalid email", () => {
    expect(optionalEmail("not-an-email")).not.toBeNull();
  });

  test("fails for missing domain", () => {
    expect(optionalEmail("user@")).not.toBeNull();
  });

  test("fails for missing local part", () => {
    expect(optionalEmail("@company.com")).not.toBeNull();
  });

  test("fails for email with spaces", () => {
    expect(optionalEmail("user @company.com")).not.toBeNull();
  });
});

describe("requiredEmail", () => {
  test("fails for empty string", () => {
    expect(requiredEmail("")).not.toBeNull();
  });

  test("passes for valid email", () => {
    expect(requiredEmail("admin@example.org")).toBeNull();
  });

  test("fails for invalid format", () => {
    expect(requiredEmail("bad-email")).not.toBeNull();
  });
});

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

describe("httpsUrl", () => {
  test("passes for a valid https URL", () => {
    expect(httpsUrl("https://idp.example.com/.well-known/openid-configuration")).toBeNull();
  });

  test("fails for empty input", () => {
    expect(httpsUrl("")).not.toBeNull();
  });

  test("fails for http (not https)", () => {
    expect(httpsUrl("http://example.com/path")).not.toBeNull();
  });

  test("fails for a non-URL string", () => {
    expect(httpsUrl("not a url")).not.toBeNull();
  });

  test("uses fieldName in error message when empty", () => {
    expect(httpsUrl("", "Discovery URL")).toMatch(/Discovery URL/);
  });
});

describe("hourRange", () => {
  test("passes for 0 (midnight)", () => {
    expect(hourRange(0)).toBeNull();
  });

  test("passes for 23", () => {
    expect(hourRange(23)).toBeNull();
  });

  test("passes for typical mid-day value", () => {
    expect(hourRange(7)).toBeNull();
  });

  test("fails for -1", () => {
    expect(hourRange(-1)).not.toBeNull();
  });

  test("fails for 24", () => {
    expect(hourRange(24)).not.toBeNull();
  });

  test("accepts string representations of valid integers", () => {
    expect(hourRange("3")).toBeNull();
  });
});

describe("keepRange", () => {
  test("passes for 1", () => {
    expect(keepRange(1)).toBeNull();
  });

  test("passes for 100", () => {
    expect(keepRange(100)).toBeNull();
  });

  test("fails for 0", () => {
    expect(keepRange(0)).not.toBeNull();
  });

  test("fails for 101", () => {
    expect(keepRange(101)).not.toBeNull();
  });

  test("accepts string representations of valid integers", () => {
    expect(keepRange("10")).toBeNull();
  });
});

describe("senderAddress", () => {
  test("passes for empty (optional field)", () => {
    expect(senderAddress("")).toBeNull();
    expect(senderAddress(null)).toBeNull();
  });

  test("passes for plain email address", () => {
    expect(senderAddress("noreply@company.com")).toBeNull();
  });

  test("passes for display-name format", () => {
    expect(senderAddress("Licenses <noreply@company.com>")).toBeNull();
  });

  test("fails for display-name format with invalid email", () => {
    expect(senderAddress("Licenses <not-an-email>")).not.toBeNull();
  });

  test("fails for plain non-email string", () => {
    expect(senderAddress("not-an-email")).not.toBeNull();
  });
});

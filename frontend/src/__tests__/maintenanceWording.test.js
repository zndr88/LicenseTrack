import { describe, expect, it } from "vitest";

const sources = import.meta.glob(
  ["../**/*.{js,jsx}", "!../__tests__/**", "!../**/__tests__/**", "!../demo/**"],
  { query: "?raw", import: "default", eager: true },
);

// "Support" in text people read, i.e. string literals and JSX text.
// Identifiers such as supportRenewal or isSupported are not matched.
const VISIBLE_SUPPORT = /(["'`>][^"'`<>{}=;&]*(?<![\w-])[Ss]upport(?![\w-])[^"'`<>{}=;&]*["'`<])/g;
// Legitimate uses: vendor/third-party support is a Service, not Maintenance.
const ALLOWED = [
  /standalone support contracts/,
  /support provider/,
  /support@example\.com/,
  /premium or third-party support/,
  /vendor support/,
  /does not support/,
  /Purchase Includes Support/, // an external CSV header name
];

describe("Maintenance wording", () => {
  it('uses "Maintenance", not "Support", for maintenance coverage', () => {
    const offenders = [];
    for (const [path, text] of Object.entries(sources)) {
      for (const [match] of text.matchAll(VISIBLE_SUPPORT)) {
        if (/supported|unsupported|supports?[A-Z]/i.test(match)) continue;
        if (ALLOWED.some((pattern) => pattern.test(match))) continue;
        offenders.push(`${path}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

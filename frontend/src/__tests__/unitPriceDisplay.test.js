import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["../**/*.{js,jsx}", "!../__tests__/**", "!../**/__tests__/**", "!../demo/**"], {
  query: "?raw", import: "default", eager: true,
});

describe("Unit price display", () => {
  it("never goes through formatCost, which rounds to two decimals (use formatUnitPrice)", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = [];
    for (const [path, text] of Object.entries(sources)) {
      text.split(/\r?\n/).forEach((line, index) => {
        if (line.includes("formatCost(") && /nitPrice/.test(line)) offenders.push(`${path}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

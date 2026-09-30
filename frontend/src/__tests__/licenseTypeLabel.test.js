import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["../**/*.jsx", "!../__tests__/**", "!../**/__tests__/**"], {
  query: "?raw", import: "default", eager: true,
});

describe("License Type label", () => {
  it("is always LicenseTypeLabel, so every picker shows the same ⓘ", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources)
      .filter(([path, text]) => !path.endsWith("/LicenseTypeLabel.jsx") && /<label[^>]*>\s*License Type\b/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

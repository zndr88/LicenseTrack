import { describe, expect, it } from "vitest";

// Every non-test source file, as raw text.
const sources = import.meta.glob(["../**/*.{js,jsx}", "!../__tests__/**", "!../**/__tests__/**"], {
  query: "?raw", import: "default", eager: true,
});

// Typed number text is read in exactly these places. Everywhere else, form
// values are already canonical (NumberInput emits them) and must never be
// re-read as typed text: under a comma-decimal format "1.250" is refused as
// ambiguous, so re-reading a stored "1.250" would break it.
const TYPED_NUMBER_READERS = [
  "utils/formatting.js",
  "components/ui/NumberInput.jsx",
  "components/procurement/ProcurementInlineEditCell.jsx",
  "components/pages/licenses/LicenseTableRowCells.jsx",
  "hooks/useLicenseData.js",
];

describe("typed number input", () => {
  it("is read only by NumberInput, the inline table cells and the list filters", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources)
      .filter(([, text]) => /\bparseTypedNumber(Result)?\b/.test(text))
      .map(([path]) => path.replace(/^\.\.\//, ""))
      .filter((path) => !TYPED_NUMBER_READERS.includes(path));
    expect(offenders).toEqual([]);
  });

  it("uses NumberInput instead of decimal text inputs", () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => /inputMode[=:]\s*["{]?\s*["']?decimal/.test(text))
      .map(([path]) => path.replace(/^\.\.\//, ""))
      .filter((path) => !TYPED_NUMBER_READERS.includes(path));
    expect(offenders).toEqual([]);
  });
});

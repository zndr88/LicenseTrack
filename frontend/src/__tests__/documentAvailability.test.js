import { describe, expect, test } from "vitest";
import {
  documentAvailabilityHelp,
  documentAvailabilitySummary,
  formatDocumentAvailabilitySummary,
  isFileAvailable,
} from "../utils/documentAvailability.js";

describe("document availability helpers", () => {
  test("summarizes total records separately from currently available files", () => {
    const summary = documentAvailabilitySummary([
      { fileAvailability: "available" },
      { fileAvailability: "missing" },
      { file_availability: "unavailable" },
      {},
    ]);

    expect(summary).toEqual({
      total: 4,
      available: 2,
      missing: 1,
      unavailable: 1,
    });
    expect(formatDocumentAvailabilitySummary(summary)).toBe("4 documents · 2 available · 1 missing · 1 unavailable");
  });

  test("defaults old document responses to available and explains unavailable files", () => {
    expect(isFileAvailable({})).toBe(true);
    expect(isFileAvailable({ fileAvailability: "missing" })).toBe(false);
    expect(documentAvailabilityHelp({ fileAvailability: "missing" })).toBe(
      "The document record exists, but the file is missing from managed storage.",
    );
    expect(documentAvailabilityHelp({ fileAvailability: "unavailable" })).toBe(
      "The document record exists, but managed storage is unavailable.",
    );
  });
});

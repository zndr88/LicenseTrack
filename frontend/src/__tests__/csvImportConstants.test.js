import { describe, expect, it } from "vitest";
import { NATIVE_FIELDS } from "../constants/csvImport.js";

describe("CSV import mapping options", () => {
  it("offers the retired Total PO Price target so older saved mappings still show it", () => {
    const option = NATIVE_FIELDS.find((field) => field.value === "total_po_price");
    expect(option?.label).toMatch(/not imported/i);
    expect(NATIVE_FIELDS.some((field) => field.value === "legacy_po_price")).toBe(false);
  });

  it("offers Line Total as a mapping target", () => {
    expect(NATIVE_FIELDS.some((field) => field.value === "line_total")).toBe(true);
  });
});

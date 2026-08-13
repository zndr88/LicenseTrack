import { describe, expect, it } from "vitest";
import {
  formatCustomFieldValue,
  getCustomColumnId,
  getCustomFieldBaseKey,
  getCustomFieldInputConfig,
  getCustomFieldSectionLabel,
} from "../utils/customFieldPresentation.js";

describe("customFieldPresentation", () => {
  it("builds a custom column id for older unprefixed field keys", () => {
    expect(getCustomColumnId({ fieldKey: "contract_owner" })).toBe("cf_contract_owner");
  });

  it("does not double-prefix backend-prefixed field keys", () => {
    expect(getCustomColumnId({ fieldKey: "cf_contract_owner" })).toBe("cf_contract_owner");
  });

  it("returns the base key without the custom field prefix", () => {
    expect(getCustomFieldBaseKey({ fieldKey: "cf_contract_owner" })).toBe("contract_owner");
    expect(getCustomFieldBaseKey({ fieldKey: "contract_owner" })).toBe("contract_owner");
  });

  it("formats boolean custom fields with current display labels", () => {
    const def = { fieldType: "boolean" };
    expect(formatCustomFieldValue("true", def)).toBe("True");
    expect(formatCustomFieldValue(true, def)).toBe("True");
    expect(formatCustomFieldValue("false", def)).toBe("False");
    expect(formatCustomFieldValue(false, def)).toBe("False");
  });

  it("preserves blank custom field display behavior by default", () => {
    const def = { fieldType: "text" };
    expect(formatCustomFieldValue("", def)).toBeNull();
    expect(formatCustomFieldValue(null, def)).toBeNull();
    expect(formatCustomFieldValue(undefined, def)).toBeNull();
  });

  it("allows callers to choose the blank display token", () => {
    expect(formatCustomFieldValue("", { fieldType: "text" }, { blankDisplay: "-" })).toBe("-");
  });

  it("formats date, currency, and number fields", () => {
    expect(formatCustomFieldValue("2026-02-14", { fieldType: "date" }, { locale: "en-GB" })).toBe("14/02/2026");
    expect(formatCustomFieldValue("1234.5", { fieldType: "currency" }, { currency: "EUR", locale: "en-US" })).toBe("€1,234.50");
    expect(formatCustomFieldValue(42, { fieldType: "number" })).toBe("42");
  });

  it("returns known section labels and a catchall fallback", () => {
    expect(getCustomFieldSectionLabel("identity")).toBe("Identity");
    expect(getCustomFieldSectionLabel("dates")).toBe("Dates & Contract");
    expect(getCustomFieldSectionLabel("commercial")).toBe("Details");
    expect(getCustomFieldSectionLabel("people")).toBe("People & Org");
    expect(getCustomFieldSectionLabel("documents")).toBe("Documents");
    expect(getCustomFieldSectionLabel("notes")).toBe("Notes");
    expect(getCustomFieldSectionLabel(null)).toBe("Custom Fields");
    expect(getCustomFieldSectionLabel("unknown")).toBe("Custom Fields");
  });

  it("returns input config for supported custom field types", () => {
    expect(getCustomFieldInputConfig({ fieldType: "date" })).toEqual({ inputType: "date" });
    expect(getCustomFieldInputConfig({ fieldType: "textarea" })).toEqual({ inputType: "textarea" });
    expect(getCustomFieldInputConfig({ fieldType: "number" })).toEqual({ inputType: "number" });
    expect(getCustomFieldInputConfig({ fieldType: "text" })).toEqual({ inputType: "text" });
    expect(getCustomFieldInputConfig({ fieldType: "boolean" })).toMatchObject({
      inputType: "select",
      blankOptionLabel: "Blank",
      selectOptions: [
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ],
    });
  });
});

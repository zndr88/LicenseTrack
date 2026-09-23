import { describe, expect, it } from "vitest";
import { resolveLineBudgetOwner } from "../../utils/renewalLineDefaults.js";
import { buildConvertItemDefaults } from "../../utils/buildConvertItemDefaults.js";
import { sourcingItemToFormDefaults } from "../../utils/sourcingItemFormModel.js";
import { isItemReady } from "../../components/procurement/ConvertItemForm.jsx";

const LICENSES = [
  { id: 1, budgetOwnerEmail: "a@example.com" },
  { id: 2, budgetOwnerEmail: "b@example.com" },
  { id: 3, budgetOwnerEmail: "A@example.com" },
];

describe("resolveLineBudgetOwner", () => {
  it("keeps the stored line value", () => {
    expect(resolveLineBudgetOwner({ budgetOwnerEmail: "line@example.com", renewalForLicenseId: 1 }, LICENSES))
      .toEqual({ value: "line@example.com", required: false });
  });

  it("falls back to the single predecessor when the line is blank", () => {
    expect(resolveLineBudgetOwner({ budgetOwnerEmail: "", renewalForLicenseId: 1 }, LICENSES))
      .toEqual({ value: "a@example.com", required: false });
  });

  it("leaves merged lines with differing owners blank and required", () => {
    expect(resolveLineBudgetOwner({ renewalForLicenseId: 1, cotermPredecessorIds: [1, 2] }, LICENSES))
      .toEqual({ value: "", required: true });
  });

  it("does not require a choice when merged owners match", () => {
    expect(resolveLineBudgetOwner({ renewalForLicenseId: 1, cotermPredecessorIds: [1, 3] }, LICENSES))
      .toEqual({ value: "", required: false });
  });
});

describe("edit-line and convert forms share one budget-owner rule", () => {
  it.each([
    [{ id: 10, budgetOwnerEmail: "", renewalForLicenseId: 1, isRenewal: true }],
    [{ id: 11, budgetOwnerEmail: "line@example.com", renewalForLicenseId: 2, isRenewal: true }],
    [{ id: 12, budgetOwnerEmail: "", renewalForLicenseId: 1, cotermPredecessorIds: [1, 2], isRenewal: true }],
  ])("shows the same value for %o", (item) => {
    const convert = buildConvertItemDefaults({ items: [item] }, LICENSES)[0];
    const edit = sourcingItemToFormDefaults(item, null, LICENSES);

    expect(convert.budgetOwnerEmail).toBe(edit.budgetOwnerEmail);
  });

  it("blocks conversion readiness until a split coterm owner is chosen", () => {
    const item = { id: 12, publisherName: "Acme", softwareDescription: "Suite", startDate: "2026-01-01", endDate: "2026-12-31", quantity: "1", estimatedUnitPrice: "1", renewalForLicenseId: 1, cotermPredecessorIds: [1, 2], isRenewal: true };
    const defaults = buildConvertItemDefaults({ items: [item] }, LICENSES)[0];

    expect(defaults.budgetOwnerRequired).toBe(true);
    expect(isItemReady(defaults)).toBe(false);
    expect(isItemReady({ ...defaults, budgetOwnerEmail: "b@example.com" })).toBe(true);
  });
});

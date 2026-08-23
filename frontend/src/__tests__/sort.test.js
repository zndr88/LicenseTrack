import { describe, expect, test } from "vitest";
import { getPoTotal } from "../utils/helpers.js";
import { getCalcTotalValue, getSortValue } from "../utils/sort.js";

const sort = (rows, key, direction = "asc", context = {}) => rows
  .map((row, index) => ({ row, index, value: getSortValue(row, key, context) }))
  .sort((a, b) => {
    const am = a.value == null || (typeof a.value === "number" && !Number.isFinite(a.value));
    const bm = b.value == null || (typeof b.value === "number" && !Number.isFinite(b.value));
    if (am || bm) return am === bm ? a.index - b.index : am ? 1 : -1;
    const cmp = typeof a.value === "number" && typeof b.value === "number"
      ? a.value - b.value
      : new Intl.Collator(undefined, { sensitivity: "base" }).compare(String(a.value), String(b.value));
    return cmp === 0 ? a.index - b.index : (direction === "asc" ? 1 : -1) * cmp;
  })
  .map(({ row }) => row);

describe("License Overview sort accessors", () => {
  test("sorts text, numeric values, zero, and missing values stably in both directions", () => {
    const rows = [{ id: "z", publisherName: "Zulu" }, { id: "two", quantity: "2" }, { id: "ten", quantity: "10" }, { id: "zero", quantity: "0" }, { id: "missing", quantity: "" }];
    expect(sort(rows, "quantity").map((row) => row.id)).toEqual(["zero", "two", "ten", "z", "missing"]);
    expect(sort(rows, "quantity", "desc").map((row) => row.id)).toEqual(["ten", "two", "zero", "z", "missing"]);
    expect(sort([{ id: 1, publisherName: "Zulu" }, { id: 2, publisherName: "Acme" }], "publisher").map((row) => row.id)).toEqual([2, 1]);
  });

  test("uses PO-wide totals, overrides, retired-row rules, and stable ties", () => {
    const rows = [
      { id: "same-a", poNumber: "PO-1", currency: "EUR", quantity: 1, unitPrice: 10 },
      { id: "po-2", poNumber: "PO-2", currency: "EUR", quantity: 1, unitPrice: 20 },
      { id: "same-b", poNumber: "PO-1", currency: "EUR", quantity: 2, unitPrice: 10 },
      { id: "override", poNumber: "PO-3", currency: "EUR", quantity: 1, unitPrice: 1, poTotalOverride: 5 },
      { id: "retired", poNumber: "PO-3", currency: "EUR", quantity: 100, unitPrice: 100, retired: true },
    ];
    expect(getSortValue(rows[0], "totalPoPrice", { allLicenses: rows })).toBe(getPoTotal("PO-1", "EUR", rows));
    expect(sort(rows, "totalPoPrice", "asc", { allLicenses: rows }).map((row) => row.id)).toEqual(["override", "retired", "po-2", "same-a", "same-b"]);
    expect(sort(rows, "totalPoPrice", "desc", { allLicenses: rows }).map((row) => row.id)).toEqual(["same-a", "same-b", "po-2", "override", "retired"]);
  });

  test("sorts calculated totals, static keys, and display labels", () => {
    const rows = [
      { id: 1, procurementReference: "PR-10", skuCode: "SKU-2", quantity: 2, unitPrice: 10, licenseType: "saas", licenseMetric: "per_user", supplier: "", maintenanceCoverage: "included", completeness: { percentage: null } },
      { id: 2, procurementReference: "PR-2", skuCode: "SKU-10", quantity: 10, unitPrice: 10, licenseType: "freeware", licenseMetric: "per_device", supplier: "Vendor", maintenanceCoverage: "unknown", completeness: { percentage: 40 } },
      { id: 3, procurementReference: null, skuCode: null, quantity: 0, unitPrice: 10, licenseType: "subscription", licenseMetric: "enterprise", supplier: "", maintenanceCoverage: "not_applicable", completeness: { percentage: 100 } },
    ];
    expect(sort(rows, "calcTotal").map((row) => row.id)).toEqual([3, 1, 2]);
    expect(sort(rows, "procurementReference").map((row) => row.id)).toEqual([1, 2, 3]);
    expect(sort(rows, "skuCode").map((row) => row.id)).toEqual([2, 1, 3]);
    expect(sort(rows, "licenseType").map((row) => row.id)).toEqual([2, 1, 3]);
    expect(sort(rows, "licenseMetric").map((row) => row.id)).toEqual([3, 2, 1]);
    expect(sort(rows, "supplier").map((row) => row.id)).toEqual([1, 3, 2]);
    expect(sort(rows, "maintenanceCoverage").map((row) => row.id)).toEqual([1, 3, 2]);
    expect(sort(rows, "complete").map((row) => row.id)).toEqual([2, 3, 1]);
  });

  test("sorts custom text, dates, currencies, numbers, and booleans", () => {
    const defs = [
      { id: 1, fieldKey: "owner", fieldType: "text" }, { id: 2, fieldKey: "renewal", fieldType: "date" },
      { id: 3, fieldKey: "budget", fieldType: "currency" }, { id: 4, fieldKey: "enabled", fieldType: "boolean" },
    ];
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const values = new Map([
      [1, [{ customFieldDefId: 1, valueText: "Zulu" }, { customFieldDefId: 2, valueText: "2026-12-01" }, { customFieldDefId: 3, valueCurrency: "100" }, { customFieldDefId: 4, valueText: "false" }]],
      [2, [{ customFieldDefId: 1, valueText: "Acme" }, { customFieldDefId: 2, valueText: "2026-01-01" }, { customFieldDefId: 3, valueCurrency: "2" }, { customFieldDefId: 4, valueText: "true" }]],
      [3, [{ customFieldDefId: 1, valueText: "Mango" }, { customFieldDefId: 2, valueText: "2026-06-01" }, { customFieldDefId: 3, valueCurrency: "10" }, { customFieldDefId: 4, valueText: "false" }]],
    ]);
    const context = { customFieldDefs: defs, customFieldValuesMap: values };
    expect(sort(rows, "cf_owner", "asc", context).map((row) => row.id)).toEqual([2, 3, 1, 4]);
    expect(sort(rows, "cf_renewal", "asc", context).map((row) => row.id)).toEqual([2, 3, 1, 4]);
    expect(sort(rows, "cf_budget", "asc", context).map((row) => row.id)).toEqual([2, 3, 1, 4]);
    expect(sort(rows, "cf_enabled", "asc", context).map((row) => row.id)).toEqual([1, 3, 2, 4]);
  });

  test("orders every supported expiration state deterministically", () => {
    const statuses = ["active", "perpetual", "upcoming", "expiring", "expired", "pending_renewal", "renewed", "retired", "legacy"];
    const rows = statuses.map((status, id) => ({ id, expiration: { status, days: id }, endDate: `2026-0${(id % 9) + 1}-01` }));
    expect(sort(rows, "expiration").map((row) => row.expiration.status)).toEqual(["expired", "expiring", "upcoming", "active", "perpetual", "pending_renewal", "renewed", "retired", "legacy"]);
  });

  test("preserves time-of-day and timezone chronology for timestamp columns", () => {
    const rows = [
      { id: "late", createdAt: "2026-08-22T08:00:00Z" },
      { id: "early", createdAt: "2026-08-22T07:00:00Z" },
      { id: "invalid", createdAt: "not-a-date" },
      { id: "blank", createdAt: "" },
    ];
    expect(sort(rows, "createdAt").map((row) => row.id)).toEqual(["early", "late", "invalid", "blank"]);
    expect(sort(rows, "createdAt", "desc").map((row) => row.id)).toEqual(["late", "early", "invalid", "blank"]);
    expect(getSortValue({ startDate: "2026-08-23" }, "startDate")).toBeLessThan(getSortValue({ startDate: "2026-08-24" }, "startDate"));
    expect(getSortValue({ startDate: "2026-02-31" }, "startDate")).toBeNull();
    expect(getSortValue({ createdAt: "2026-08-22T08:00:00+02:00" }, "createdAt")).toBeLessThan(getSortValue({ createdAt: "2026-08-22T08:00:00Z" }, "createdAt"));
  });

  test.each([
    ["blank", "100"], ["5", ""], [null, "100"], ["100", undefined], ["invalid", "100"],
  ])("Calc. Total treats missing operand %s as missing", (quantity, unitPrice) => {
    expect(getCalcTotalValue({ quantity, unitPrice })).toBeNull();
    expect(getSortValue({ quantity, unitPrice }, "calcTotal")).toBeNull();
  });

  test.each([[0, 100, 0], ["0", "100", 0], [5, "0", 0]])("Calc. Total agrees for valid zero operands", (quantity, unitPrice, expected) => {
    const license = { quantity, unitPrice };
    expect(getCalcTotalValue(license)).toBe(expected);
    expect(getSortValue(license, "calcTotal")).toBe(expected);
  });

  test("uses start dates for Upcoming expiration ties even when end dates conflict", () => {
    const rows = [
      { id: "later-start", expiration: { status: "upcoming" }, startDate: "2026-09-10", endDate: "2026-09-01" },
      { id: "earlier-start", expiration: { status: "upcoming" }, startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    expect(sort(rows, "expiration").map((row) => row.id)).toEqual(["earlier-start", "later-start"]);
    expect(sort(rows, "expiration", "desc").map((row) => row.id)).toEqual(["later-start", "earlier-start"]);
  });
});

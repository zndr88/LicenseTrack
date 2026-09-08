import { describe, expect, test } from "vitest";
import { getVisibleColumns, hasUpcomingReplacement, isColumnFilterable, rowStyle } from "../components/pages/licenses/licenseTableShared.js";
import { hasSortAccessor } from "../utils/sort.js";
import {
  COLUMN_DEFS,
  getFullExportColumns,
  makeCustomFieldColumnDefs,
  VISIBLE_IN_LIST_DEFAULTS,
} from "../components/pages/licenses/licenseColumns.js";

const columns = [
  { key: "publisher" },
  { key: "startDate" },
  { key: "endDate" },
  { key: "expiration", always: true },
];

describe("upcoming replacement row indicator", () => {
  const predecessor = { id: 1, renewedToId: 2, expiration: { status: "expiring" } };

  test("marks an expiring predecessor only when its linked successor is upcoming", () => {
    expect(hasUpcomingReplacement(predecessor, { id: 2, expiration: { status: "upcoming" } })).toBe(true);
  });

  test.each(["active", "expired", "renewed", "retired"])("does not mark a %s successor", (status) => {
    expect(hasUpcomingReplacement(predecessor, { id: 2, expiration: { status } })).toBe(false);
  });

  test("does not infer a successor from pending workflow or an unresolved link", () => {
    expect(hasUpcomingReplacement(predecessor)).toBe(false);
    expect(hasUpcomingReplacement(predecessor, { id: 3, expiration: { status: "upcoming" } })).toBe(false);
    expect(hasUpcomingReplacement({ ...predecessor, renewedToId: null, lifecycleStatus: "pending_renewal" })).toBe(false);
  });

  test("keeps expired gaps visibly overdue even when a successor is upcoming", () => {
    const expired = { ...predecessor, expiration: { status: "expired" } };
    expect(hasUpcomingReplacement(expired, { id: 2, expiration: { status: "upcoming" } })).toBe(false);
    expect(rowStyle(expired)).toEqual({ background: "var(--red-dim)", borderLeft: "3px solid var(--red)" });
  });

  test("preserves expiring urgency shade while indicating the upcoming replacement", () => {
    expect(rowStyle(predecessor, true)).toEqual({ background: "var(--orange-dim)", borderLeft: "3px solid var(--steel)" });
    expect(rowStyle(predecessor)).toEqual({ background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)" });
  });
});

describe("getVisibleColumns", () => {
  test("hides both date columns when the grouped dates preference is disabled", () => {
    const visible = getVisibleColumns(columns, {
      publisher: true,
      dates: false,
      startDate: true,
      endDate: true,
    });

    expect(visible.map((column) => column.key)).toEqual(["publisher", "expiration"]);
  });

  test("shows both date columns when the grouped dates preference is enabled", () => {
    const visible = getVisibleColumns(columns, {
      publisher: true,
      dates: true,
      startDate: true,
      endDate: true,
    });

    expect(visible.map((column) => column.key)).toEqual([
      "publisher",
      "startDate",
      "endDate",
      "expiration",
    ]);
  });

  test("preserves individual date-column hiding while the group is enabled", () => {
    const visible = getVisibleColumns(columns, {
      publisher: true,
      dates: true,
      startDate: false,
      endDate: true,
    });

    expect(visible.map((column) => column.key)).toEqual([
      "publisher",
      "endDate",
      "expiration",
    ]);
  });
});

describe("license column registry", () => {
  test("advertises only supported header capabilities", () => {
    expect(hasSortAccessor({ key: "select" })).toBe(false);
    expect(hasSortAccessor({ key: "procurementReference" })).toBe(true);
    expect(hasSortAccessor({ key: "cf_owner", _cfDef: { id: 1, fieldKey: "owner", fieldType: "text" } })).toBe(true);
    expect(isColumnFilterable({ key: "totalPoPrice" })).toBe(false);
    expect(isColumnFilterable({ key: "calcTotal" })).toBe(false);
    expect(isColumnFilterable({ key: "effectiveQuantity" })).toBe(true);
    expect(isColumnFilterable({ key: "cf_owner", _cfDef: { id: 1 } })).toBe(true);
    expect(hasSortAccessor({ key: "unknown" })).toBe(false);
    expect(hasSortAccessor({ key: "cf_owner" })).toBe(false);
  });

  test("keeps the sortable registry contract aligned with every static column", () => {
    for (const column of COLUMN_DEFS) {
      expect(hasSortAccessor(column), `${column.key} should have a sort accessor`).toBe(column.key !== "select");
    }
    expect(hasSortAccessor(makeCustomFieldColumnDefs([{ id: 9, fieldKey: "owner", fieldType: "text" }])[0])).toBe(true);
    expect(hasSortAccessor(makeCustomFieldColumnDefs([{ id: 9, fieldKey: "owner" }])[0])).toBe(false);
  });
  test("keeps newly added advanced columns hidden by default", () => {
    expect(VISIBLE_IN_LIST_DEFAULTS.recordId).toBe(false);
    expect(VISIBLE_IN_LIST_DEFAULTS.createdAt).toBe(false);
    expect(VISIBLE_IN_LIST_DEFAULTS.updatedAt).toBe(false);
    expect(VISIBLE_IN_LIST_DEFAULTS.notes).toBe(false);
  });

  test("includes hidden and custom columns in full-data exports but excludes selection", () => {
    const custom = makeCustomFieldColumnDefs([{ id: 4, fieldKey: "owner", name: "Owner" }]);
    const fullExportKeys = getFullExportColumns([...COLUMN_DEFS, ...custom]).map((column) => column.key);

    expect(fullExportKeys).not.toContain("select");
    expect(fullExportKeys).toContain("recordId");
    expect(fullExportKeys).toContain("notes");
    expect(fullExportKeys).toContain("createdAt");
    expect(fullExportKeys).toContain("cf_owner");
  });
});

import { describe, expect, it } from "vitest";
import {
  GROUPABLE_COLUMNS,
  MAX_GROUP_LEVELS,
  allGroupIds,
  findGroupPathIds,
  flattenGroups,
  getGroupableColumn,
  groupLicenses,
  groupedLines,
  sanitizeGroupBy,
} from "../components/pages/licenses/registryGrouping.js";

const value = (key, license) => getGroupableColumn(key).read(license);

describe("groupable columns", () => {
  it("offers exactly the ten approved columns", () => {
    expect(GROUPABLE_COLUMNS.map((c) => c.key)).toEqual([
      "poNumber", "publisher", "supplier", "costCentre", "licenseType",
      "endYear", "status", "currency", "contractNumber", "budgetOwnerEmail",
    ]);
    expect(MAX_GROUP_LEVELS).toBe(2);
  });

  it("matches PO numbers ignoring case and extra spaces, keeping the typed label", () => {
    expect(value("poNumber", { poNumber: "  PO-2026  0142 " })).toEqual({ key: "po-2026 0142", label: "PO-2026  0142" });
    expect(value("poNumber", { poNumber: "" })).toBeNull();
  });

  it("treats a blank supplier as Direct, like the table", () => {
    expect(value("supplier", { supplier: "" })).toEqual({ key: "direct", label: "Direct" });
  });

  it("uses type labels, end years and status labels", () => {
    expect(value("licenseType", { licenseType: "saas" })).toEqual({ key: "saas", label: "SaaS" });
    expect(value("endYear", { endDate: "2027-10-31" })).toEqual({ key: "2027", label: "2027" });
    expect(value("endYear", { endDate: "" })).toBeNull();
    expect(value("status", { expiration: { status: "expiring" } })).toEqual({ key: "expiring", label: "Expiring" });
    expect(value("currency", { currency: "eur" })).toEqual({ key: "EUR", label: "EUR" });
  });
});

describe("sanitizeGroupBy", () => {
  it("keeps known, unique keys up to two levels", () => {
    expect(sanitizeGroupBy(["poNumber", "publisher", "status"])).toEqual(["poNumber", "publisher"]);
    expect(sanitizeGroupBy(["poNumber", "poNumber"])).toEqual(["poNumber"]);
    expect(sanitizeGroupBy(["nope", "publisher"])).toEqual(["publisher"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(sanitizeGroupBy(undefined)).toEqual([]);
    expect(sanitizeGroupBy("poNumber")).toEqual([]);
  });
});

const lic = (id, overrides = {}) => ({
  id,
  poNumber: "PO-1",
  publisherName: "Okta",
  currency: "EUR",
  quantity: "1",
  unitPrice: "100",
  endDate: "2027-01-31",
  expiration: { status: "active" },
  ...overrides,
});

describe("groupLicenses", () => {
  it("returns no groups when groupBy is empty", () => {
    expect(groupLicenses([lic(1)], [], { allLicenses: [lic(1)] })).toEqual([]);
  });

  it("orders groups by value with the blank group last, lines keep their sort order", () => {
    const lines = [lic(1, { poNumber: "PO-B" }), lic(2, { poNumber: "" }), lic(3, { poNumber: "po-a" }), lic(4, { poNumber: "PO-A" })];
    const groups = groupLicenses(lines, ["poNumber"], { allLicenses: lines });
    expect(groups.map((g) => g.label)).toEqual(["po-a", "PO-B", "(No PO #)"]);
    expect(groups[0].lines.map((l) => l.id)).toEqual([3, 4]);
    expect(groups[2].key).toBeNull();
  });

  it("nests a second level with path-based ids", () => {
    const lines = [lic(1, { publisherName: "Okta" }), lic(2, { publisherName: "Adobe" })];
    const [po] = groupLicenses(lines, ["poNumber", "publisher"], { allLicenses: lines });
    expect(po.children.map((c) => c.label)).toEqual(["Adobe", "Okta"]);
    expect(po.children[0].id).toBe("poNumber:po-1/publisher:adobe");
    expect(po.children[0].depth).toBe(1);
  });

  it("counts shown vs. all lines of the group", () => {
    const all = [lic(1), lic(2), lic(3, { expiration: { status: "retired" } })];
    const [group] = groupLicenses(all.slice(0, 2), ["poNumber"], { allLicenses: all });
    expect(group.summary.shownCount).toBe(2);
    expect(group.summary.totalCount).toBe(3);
  });

  it("keeps line sums per currency and skips lines without an amount", () => {
    const lines = [lic(1), lic(2, { currency: "USD", unitPrice: "50" }), lic(3, { unitPrice: "" })];
    const [group] = groupLicenses(lines, ["publisher"], { allLicenses: lines });
    expect(group.summary.lineSumByCurrency).toEqual({ EUR: 100, USD: 50 });
  });

  it("takes the earliest end date of live lines only", () => {
    const lines = [
      lic(1, { endDate: "2028-01-01" }),
      lic(2, { endDate: "2026-01-01", expiration: { status: "renewed" } }),
      lic(3, { endDate: "2027-06-30", expiration: { status: "expiring" } }),
    ];
    const [group] = groupLicenses(lines, ["publisher"], { allLicenses: lines });
    expect(group.summary.earliestEndDate).toBe("2027-06-30");
  });

  it("PO groups show Total PO Value once per purchase and flag a differing manual total", () => {
    const lines = [lic(1, { poTotalOverride: "150" }), lic(2)];
    const [group] = groupLicenses(lines, ["poNumber"], { allLicenses: lines });
    expect(group.summary.poTotalByCurrency).toEqual({ EUR: 150 });
    expect(group.summary.poOverrideMismatch).toBe(true);
  });

  it("does not flag a PO without a manual total, or one that matches", () => {
    const plain = [lic(1), lic(2)];
    expect(groupLicenses(plain, ["poNumber"], { allLicenses: plain })[0].summary.poOverrideMismatch).toBe(false);
    const matching = [lic(1, { poTotalOverride: "200" }), lic(2)];
    expect(groupLicenses(matching, ["poNumber"], { allLicenses: matching })[0].summary.poOverrideMismatch).toBe(false);
  });

  it("splits a PO used in two currencies into one total per currency", () => {
    const lines = [lic(1), lic(2, { currency: "USD", unitPrice: "40" })];
    const [group] = groupLicenses(lines, ["poNumber"], { allLicenses: lines });
    expect(group.summary.poTotalByCurrency).toEqual({ EUR: 100, USD: 40 });
  });

  it("non-PO groups have no PO figures", () => {
    const [group] = groupLicenses([lic(1)], ["publisher"], { allLicenses: [lic(1)] });
    expect(group.summary.poTotalByCurrency).toBeNull();
    expect(group.summary.poOverrideMismatch).toBe(false);
  });
});

describe("flattenGroups", () => {
  const lines = [
    lic(1, { poNumber: "PO-1", publisherName: "Okta" }),
    lic(2, { poNumber: "PO-1", publisherName: "Adobe" }),
    lic(3, { poNumber: "PO-2", publisherName: "Okta" }),
  ];
  const twoLevels = groupLicenses(lines, ["poNumber", "publisher"], { allLicenses: lines });

  it("shows only top-level headers when everything is collapsed", () => {
    const rows = flattenGroups(twoLevels, new Set());
    expect(rows.map((r) => r.type)).toEqual(["group", "group"]);
  });

  it("shows children of an open group, and lines of an open leaf group", () => {
    const rows = flattenGroups(twoLevels, new Set(["poNumber:po-1", "poNumber:po-1/publisher:okta"]));
    expect(rows.map((r) => (r.type === "group" ? r.node.id : r.license.id))).toEqual([
      "poNumber:po-1",
      "poNumber:po-1/publisher:adobe",
      "poNumber:po-1/publisher:okta",
      1,
      "poNumber:po-2",
    ]);
    expect(rows[3]).toMatchObject({ type: "line", depth: 2 });
  });

  it("an open child under a closed parent stays hidden", () => {
    const rows = flattenGroups(twoLevels, new Set(["poNumber:po-1/publisher:okta"]));
    expect(rows).toHaveLength(2);
  });
});

describe("groupedLines and findGroupPathIds", () => {
  const lines = [lic(1, { poNumber: "PO-2" }), lic(2, { poNumber: "PO-1" }), lic(3, { poNumber: "PO-2" })];
  const groups = groupLicenses(lines, ["poNumber"], { allLicenses: lines });

  it("lists every line in grouped order, for export", () => {
    expect(groupedLines(groups).map((l) => l.id)).toEqual([2, 1, 3]);
  });

  it("finds the group ids that contain a line", () => {
    expect(findGroupPathIds(groups, 3)).toEqual(["poNumber:po-2"]);
    expect(findGroupPathIds(groups, 99)).toEqual([]);
  });
});

describe("grouping performance guard", () => {
  it("groups and flattens 3,000 lines in two levels well within budget", () => {
    const many = Array.from({ length: 3000 }, (_, i) => lic(i + 1, {
      poNumber: `PO-${i % 300}`,
      publisherName: `Publisher ${i % 40}`,
      poTotalOverride: i % 10 === 0 ? "1000" : "",
    }));
    const started = Date.now();
    const nodes = groupLicenses(many, ["poNumber", "publisher"], { allLicenses: many });
    flattenGroups(nodes, new Set(allGroupIds(nodes)));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

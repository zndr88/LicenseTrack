import { describe, expect, it } from "vitest";
import {
  coversConfirmMessage,
  isHiddenFromLinking,
  isLinkedToParent,
  maintenanceCandidate,
  maintenanceLinkCandidates,
  parentCandidate,
} from "../../utils/maintenanceLinking.js";

const parentA = { id: 1, licenseRef: "LT-1", publisherName: "Acme", softwareDescription: "Suite", licenseType: "perpetual" };
const parentB = { id: 2, licenseRef: "LT-2", publisherName: "Beta", softwareDescription: "Tool", licenseType: "oem" };
const record = {
  id: 9, licenseRef: "LT-9", publisherName: "Acme", softwareDescription: "Support",
  licenseType: "maintenance", poNumber: "PO-9", contractNumber: "C-9",
  startDate: "2026-01-01", endDate: "2026-12-31", maintenanceParentIds: [2],
};
const all = [parentA, parentB, record];

describe("maintenanceLinking", () => {
  it("partitions eligible records and excludes active links, not historical parent IDs", () => {
    const records = [
      parentA,
      { ...record, parentLicenseId: 1 },
      { ...record, id: 10, retired: true },
      { ...record, id: 11, retirementScheduled: true },
      { ...record, id: 12, maintenanceParentIds: ["1"], isRetired: true },
    ];
    const groups = maintenanceLinkCandidates(records, 1);
    expect(groups.all.map((item) => item.id)).toEqual([9, 10, 11]);
    expect(groups.visible.map((item) => item.id)).toEqual([9]);
    expect(groups.hidden.map((item) => item.id)).toEqual([10, 11]);
  });

  it("searches id, ref, publisher, description, PO, contract, dates and covered licenses", () => {
    const candidate = maintenanceCandidate(record, all);
    for (const needle of ["9", "lt-9", "acme", "support", "po-9", "c-9", "2026-12-31", "beta", "tool"]) {
      expect(candidate.searchText).toContain(needle);
    }
  });

  it("shows what a record currently covers", () => {
    expect(maintenanceCandidate(record, all).coversText).toBe("Currently covers: LT-2 Beta / Tool");
  });

  it("searches parents on the same fields", () => {
    expect(parentCandidate(parentA).searchText).toContain("suite");
    expect(parentCandidate({ ...parentA, poNumber: "PO-1" }).searchText).toContain("po-1");
  });

  it("knows linked and hidden records", () => {
    expect(isLinkedToParent(record, 2)).toBe(true);
    expect(isLinkedToParent(record, 1)).toBe(false);
    expect(isHiddenFromLinking({ ...record, isRetired: true })).toBe(true);
    expect(isHiddenFromLinking({ ...record, retirementScheduled: true })).toBe(true);
    expect(isHiddenFromLinking(record)).toBe(false);
  });

  it("words the confirmation for a record that already covers something", () => {
    expect(coversConfirmMessage(maintenanceCandidate(record, all))).toBe(
      "This maintenance record already covers LT-2 Beta / Tool. Also cover this license?",
    );
    expect(coversConfirmMessage(maintenanceCandidate({ ...record, maintenanceParentIds: [] }, all))).toBeNull();
  });
});

describe("maintenance parent types have one owner", () => {
  // Other rules that happen to use the same three types are named here on purpose.
  const OTHER_RULES = ["/constants/licenseData.js", "/utils/reportHelpers.js", "/utils/maintenanceCoverage.js"];
  const sources = import.meta.glob("../../**/*.{js,jsx}", { query: "?raw", import: "default", eager: true });

  it("keeps maintenance-link eligibility in the shared helper", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/__tests__|\.test\.|\/demo\//.test(path))
      .filter(([path]) => !path.endsWith("/utils/maintenanceLinking.js"))
      .filter(([, text]) => /licenseType\s*[!=]==?\s*["']maintenance["'][^\n]*isLinkedToParent/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("does not spell out the perpetual/oem/freeware list outside its owner", () => {
    const copy = /"perpetual"[^\n]*"oem"[^\n]*"freeware"|"freeware"[^\n]*"perpetual"[^\n]*"oem"|=== "perpetual" \|\| [^\n]*=== "oem"/;
    const offenders = Object.entries(sources)
      .filter(([path]) => !/__tests__|\.test\.|\/demo\/|\/generated\//.test(path))
      .filter(([path]) => !OTHER_RULES.some((owner) => path.endsWith(owner)))
      .filter(([, text]) => copy.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("maintenanceCandidate dates", () => {
  it("shows dates in the user's format and still finds the stored form", () => {
    const record = { id: 5, licenseType: "maintenance", startDate: "2026-01-01", endDate: "2026-12-31", maintenanceParentIds: [] };
    const candidate = maintenanceCandidate(record, [record], { formatDay: (value) => value.split("-").reverse().join("/") });
    expect(candidate.meta).toContain("01/01/2026 -> 31/12/2026");
    expect(candidate.searchText).toContain("2026-12-31");
    expect(candidate.searchText).toContain("31/12/2026");
  });
});

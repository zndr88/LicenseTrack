import { describe, expect, it } from "vitest";
import {
  isHiddenFromLinking,
  isLinkedToParent,
  maintenanceCandidate,
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
});

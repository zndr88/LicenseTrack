import { describe, expect, it } from "vitest";
import { getExistingSuccessorCandidates } from "../components/licenses/ExistingSuccessorModal.jsx";

const predecessor = {
  id: 1, publisherName: "Acme Corp", softwareDescription: "Year 1",
  startDate: "2025-01-01", endDate: "2026-01-01",
};
const successor = {
  id: 2, publisherName: " acme   corp ", softwareDescription: "Year 2",
  poNumber: "NEW-PO", skuCode: "NEW-SKU", licenseMetric: "per_device",
  licenseType: "subscription", expirationStatus: "upcoming",
  startDate: "2026-01-02", endDate: "2027-01-01",
};

describe("existing successor candidates", () => {
  it("matches publisher despite different descriptions and purchase details", () => {
    expect(getExistingSuccessorCandidates(predecessor, [successor]).map(({ candidate }) => candidate.id)).toEqual([2]);
  });

  it.each([
    { publisherName: "Other publisher" },
    { publisherName: "" },
    { retired: true },
    { retirementScheduled: true },
    { lifecycleStatus: "pending_renewal" },
    { renewedFromId: 3 },
    { renewedToId: 3 },
    { cotermFromIds: [3] },
    { expirationStatus: "expired" },
    { licenseType: "service" },
    { endDate: predecessor.endDate },
    { startDate: predecessor.startDate },
  ])("excludes an ineligible successor: %j", (overrides) => {
    expect(getExistingSuccessorCandidates(predecessor, [{ ...successor, ...overrides }])).toEqual([]);
  });
});

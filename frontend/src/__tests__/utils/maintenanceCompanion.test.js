import { describe, expect, test } from "vitest";

import { buildMaintenanceCompanion } from "../../utils/maintenanceCompanion.js";

const parent = {
  id: "L1",
  publisherName: "Acme",
  softwareDescription: "Suite",
  quantity: "5",
  quantityPerUnit: "2",
  currency: "USD",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  maintenanceStartDate: "",
  maintenanceEndDate: "",
  supplier: "Reseller",
  contactEmail: "s@x.io",
  costCentre: "CC-1",
  budgetOwnerEmail: "owner@x.io",
  secondaryContacts: "a@x.io",
};

describe("buildMaintenanceCompanion", () => {
  test("inherits identity, term and relationships from the parent", () => {
    const companion = buildMaintenanceCompanion(parent, { idFactory: () => "C1" });
    expect(companion).toMatchObject({
      id: "C1",
      licenseType: "maintenance",
      isMaintenanceCompanion: true,
      parentLineId: "L1",
      publisherName: "Acme",
      softwareDescription: "Suite maintenance/support",
      quantity: "5",
      quantityPerUnit: "2",
      currency: "USD",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      supplier: "Reseller",
      contactEmail: "s@x.io",
      costCentre: "CC-1",
      budgetOwnerEmail: "owner@x.io",
      secondaryContacts: "a@x.io",
    });
  });

  test("prefers the parent's maintenance term when present", () => {
    const companion = buildMaintenanceCompanion(
      { ...parent, maintenanceStartDate: "2026-03-01", maintenanceEndDate: "2027-02-28" },
      { idFactory: () => "C2" },
    );
    expect(companion.startDate).toBe("2026-03-01");
    expect(companion.endDate).toBe("2027-02-28");
  });

  test("parentLineId can be overridden for the primary line", () => {
    const companion = buildMaintenanceCompanion(
      { ...parent, id: undefined },
      { idFactory: () => "C3", parentLineId: "primary" },
    );
    expect(companion.parentLineId).toBe("primary");
  });

  test("falls back to sensible defaults for a blank parent", () => {
    const companion = buildMaintenanceCompanion({}, { idFactory: () => "C4" });
    expect(companion).toMatchObject({
      softwareDescription: "Software maintenance/support",
      quantity: "1",
      quantityPerUnit: "1",
      currency: "EUR",
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { computeTotalPoValue, store, resetStore, seedStore } from "../store.js";

describe("demo store seed/reset", () => {
  beforeEach(() => resetStore());

  it("seeds licenses including exactly one expiring in ~20 days", () => {
    seedStore();
    expect(store.licenses.length).toBeGreaterThanOrEqual(12);
    const expiring = store.licenses.filter(
      (l) => l.daysUntilExpiry !== null && l.daysUntilExpiry > 0 && l.daysUntilExpiry <= 30 && !l.isRetired
    );
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    expect(expiring.some((l) => l.daysUntilExpiry === 20)).toBe(true);
  });

  it("seeds sourcing items and one pending order with line items", () => {
    seedStore();
    expect(store.sourcingItems.length).toBeGreaterThanOrEqual(2);
    expect(store.pendingOrders.length).toBe(1);
    expect(store.pendingOrders[0].items.length).toBeGreaterThanOrEqual(1);
  });

  it("derives bundled support fields for subscription seed licenses", () => {
    seedStore();
    const jetbrains = store.licenses.find((license) => license.publisherName === "JetBrains");

    expect(jetbrains).toMatchObject({
      licenseType: "subscription",
      maintenanceCoverage: "included",
      maintenanceStartDate: jetbrains.startDate,
      maintenanceEndDate: jetbrains.endDate,
      maintenancePricingBasis: "flat",
      maintenanceCost: jetbrains.totalPoPrice,
    });
  });

  it("does not double-count bundled subscription support in demo procurement totals", () => {
    const total = computeTotalPoValue([
      {
        licenseType: "subscription",
        estimatedTotalPrice: "1000.00",
        maintenanceCoverage: "included",
        maintenanceCost: "1000.00",
        currency: "EUR",
      },
    ]);

    expect(total).toBe("€1,000.00");
  });

  it("reset clears everything", () => {
    seedStore();
    resetStore();
    expect(store.licenses).toEqual([]);
    expect(store.sourcingItems).toEqual([]);
    expect(store.pendingOrders).toEqual([]);
  });
});

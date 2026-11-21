import { beforeEach, describe, expect, it } from "vitest";
import { demoRequest } from "../router.js";
import { computeStats, resetStore, store } from "../store.js";
import { daysFromNow } from "../time.js";

const roundedByCurrency = (amounts) => Object.fromEntries(
  Object.entries(amounts)
    .map(([currency, amount]) => [currency, Math.round(amount * 100) / 100])
    .sort(([a], [b]) => a.localeCompare(b)),
);

async function reportAnnualCost() {
  const { data, error } = await demoRequest("/api/reports/detailed", { method: "GET" });
  expect(error).toBeNull();
  return roundedByCurrency(data.budgetForecast.baselineByCurrency);
}

const includedSupportParent = () => store.licenses.find(
  (license) => license.licenseType === "perpetual"
    && license.maintenanceCoverage === "included"
    && Number(license.maintenanceCost) > 0,
);

describe("demo annual cost: registry header and Reports page", () => {
  beforeEach(async () => {
    resetStore();
    await demoRequest("/api/auth/login", {
      method: "POST", body: JSON.stringify({ username: "demo", password: "demo" }),
    });
  });

  it("show the same totals for the seeded licenses", async () => {
    const registry = roundedByCurrency(computeStats().annual_cost_by_currency);
    expect(Object.keys(registry).length).toBeGreaterThan(0);
    expect(registry).toEqual(await reportAnnualCost());
  });

  it("count paid included maintenance on a perpetual license while its term is current", async () => {
    const parent = includedSupportParent();
    expect(parent).toBeDefined();
    const withSupport = computeStats().annual_cost_by_currency[parent.currency];

    parent.maintenanceEndDate = daysFromNow(-1);
    const afterSupportEnded = computeStats().annual_cost_by_currency[parent.currency];

    expect(withSupport - afterSupportEnded).toBeCloseTo(Number(parent.maintenanceCost), 2);
    expect(roundedByCurrency(computeStats().annual_cost_by_currency)).toEqual(await reportAnnualCost());
  });

  it("leave out maintenance that has not started yet", () => {
    const parent = includedSupportParent();
    const withSupport = computeStats().annual_cost_by_currency[parent.currency];

    parent.maintenanceStartDate = daysFromNow(1);

    expect(withSupport - computeStats().annual_cost_by_currency[parent.currency])
      .toBeCloseTo(Number(parent.maintenanceCost), 2);
  });

  it("count a recurring record with an unreadable amount as excluded from totals", () => {
    const recurring = store.licenses.find(
      (license) => license.licenseType === "subscription" && license.expirationStatus === "active",
    );
    const before = computeStats();
    expect(before.excluded_from_totals).toBe(0);

    recurring.unitPrice = "1.234,50";
    const after = computeStats();

    expect(after.excluded_from_totals).toBe(1);
    expect(after.annual_cost_by_currency[recurring.currency])
      .toBeLessThan(before.annual_cost_by_currency[recurring.currency]);
  });
});

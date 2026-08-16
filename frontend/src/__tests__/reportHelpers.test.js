import { describe, expect, test } from "vitest";

import {
  filterLicenses,
  getBudgetForecast,
  getCostOverview,
  getLifecycleCounts,
  getRenewalCalendar,
  getSpendByPublisher,
  getVendorTable,
} from "../utils/reportHelpers.js";

function license(overrides = {}) {
  return {
    id: 1,
    publisherName: "Acme",
    softwareDescription: "Acme Suite",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    unitPrice: "25",
    totalPoPrice: "250",
    currency: "EUR",
    poNumber: "PO-1",
    isRetired: false,
    ...overrides,
  };
}

function withNegativeOffsetDateOnlyParsing(callback) {
  const realDate = Date;
  globalThis.Date = class extends realDate {
    constructor(...args) {
      if (args.length === 0) {
        super(2026, 4, 15);
      } else if (args.length === 1 && typeof args[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
        const [year, month, day] = args[0].split("-").map(Number);
        super(year, month - 1, day - 1, 17, 0, 0);
      } else {
        super(...args);
      }
    }

    static now() {
      return new realDate(2026, 4, 15).getTime();
    }

    static parse(value) {
      return realDate.parse(value);
    }

    static UTC(...args) {
      return realDate.UTC(...args);
    }
  };

  try {
    callback();
  } finally {
    globalThis.Date = realDate;
  }
}

describe("report cost helpers", () => {
  test("default report filtering excludes retired and legacy records", () => {
    const filtered = filterLicenses([
      license({ id: 1, isRetired: false, lifecycleStatus: null }),
      license({ id: 2, isRetired: true, lifecycleStatus: null }),
      license({ id: 3, isRetired: false, lifecycleStatus: "legacy" }),
    ]);

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  test("includeRetired report filtering includes retired and legacy records", () => {
    const filtered = filterLicenses([
      license({ id: 1, isRetired: false, lifecycleStatus: null }),
      license({ id: 2, isRetired: true, lifecycleStatus: null }),
      license({ id: 3, isRetired: false, lifecycleStatus: "legacy" }),
    ], { includeRetired: true });

    expect(filtered.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  test("date range filtering includes licenses whose terms overlap the selected range", () => {
    const filtered = filterLicenses([
      license({ id: 1, startDate: "2025-01-01", endDate: "2030-12-31" }),
      license({ id: 2, startDate: "2024-01-01", endDate: "2024-12-31" }),
      license({ id: 3, startDate: "2027-01-01", endDate: "2027-12-31" }),
    ], { dateRange: { from: "2026-01-01", to: "2026-12-31" } });

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  test("calculates license and PO spend from line values when no override exists", () => {
    const licenses = [
      license({ id: 1, poNumber: "PO-1", totalPoPrice: "1000", quantity: "10", unitPrice: "20" }),
      license({ id: 2, poNumber: "PO-1", totalPoPrice: "1000", quantity: "5", unitPrice: "30" }),
      license({ id: 3, poNumber: "PO-2", totalPoPrice: "400", licenseType: "perpetual", quantity: "1", unitPrice: "400" }),
    ];

    const overview = getCostOverview(licenses);

    expect(overview.licenseSpendByCurrency).toEqual({ EUR: 750 });
    expect(overview.poSpendByCurrency).toEqual({ EUR: 750 });
    expect(overview.spendDifferenceByCurrency).toEqual({ EUR: 0 });
    expect(overview.poCount).toBe(2);
    expect(overview.recurringAnnualCostByCurrency).toEqual({ EUR: 350 });
    expect(overview.recurringCount).toBe(2);
  });

  test("uses a shared manual PO override once and exposes its unallocated difference", () => {
    const overview = getCostOverview([
      license({
        id: 1,
        poNumber: "PO-OVERRIDE",
        poTotalOverride: "1250.00",
        totalPoPrice: "0",
        quantity: "10",
        unitPrice: "0",
      }),
      license({
        id: 2,
        poNumber: "PO-OVERRIDE",
        poTotalOverride: "1250.00",
        totalPoPrice: "0",
        quantity: "5",
        unitPrice: "0",
      }),
    ]);

    expect(overview.licenseSpendByCurrency).toEqual({ EUR: 0 });
    expect(overview.poSpendByCurrency).toEqual({ EUR: 1250 });
    expect(overview.spendDifferenceByCurrency).toEqual({ EUR: 1250 });
    expect(overview.poCount).toBe(1);
    expect(overview.overriddenPoCount).toBe(1);
  });

  test("counts licenses without a PO number individually in both spend totals", () => {
    const overview = getCostOverview([
      license({ id: 1, poNumber: "", quantity: "2", unitPrice: "100" }),
      license({ id: 2, poNumber: null, quantity: "3", unitPrice: "50" }),
    ]);

    expect(overview.licenseSpendByCurrency).toEqual({ EUR: 350 });
    expect(overview.poSpendByCurrency).toEqual({ EUR: 350 });
    expect(overview.unkeyedCount).toBe(2);
    expect(overview.poCount).toBe(0);
  });

  test("annualizes recurring cost for multi-year subscriptions", () => {
    const forecast = getBudgetForecast([
      license({
        id: 1,
        startDate: "2025-01-01",
        endDate: "2029-12-31",
        quantity: "1",
        unitPrice: "18000000",
        totalPoPrice: "18000000",
      }),
    ]);

    expect(forecast.baselineByCurrency.EUR).toBe(3598028.48);
    expect(forecast.recurringRecords[0].annualCost).toBe(3598028.48);
  });

  test("allocates recurring spend by overlapping days for selected report ranges", () => {
    const promo = license({
      id: 1,
      startDate: "2026-01-01",
      endDate: "2027-06-30",
      quantity: "1",
      unitPrice: "12000",
      totalPoPrice: "12000",
    });

    const firstYear = getCostOverview([promo], {
      dateRange: { from: "2026-01-01", to: "2026-12-31" },
    });
    const secondYear = getCostOverview([promo], {
      dateRange: { from: "2027-01-01", to: "2027-12-31" },
    });

    expect(firstYear.licenseSpendByCurrency.EUR).toBe(8021.98);
    expect(firstYear.poSpendByCurrency.EUR).toBe(8021.98);
    expect(firstYear.recurringAnnualCostByCurrency.EUR).toBe(8021.98);
    expect(firstYear.isPeriodAllocated).toBe(true);
    expect(secondYear.licenseSpendByCurrency.EUR).toBe(3978.02);
    expect(secondYear.poSpendByCurrency.EUR).toBe(3978.02);
    expect(secondYear.recurringAnnualCostByCurrency.EUR).toBe(3978.02);
    expect(firstYear.licenseSpendByCurrency.EUR + secondYear.licenseSpendByCurrency.EUR).toBe(12000);
  });

  test("publisher and vendor spend use selected-period allocation", () => {
    const promo = license({
      id: 1,
      publisherName: "Promo Publisher",
      supplier: "Promo Supplier",
      startDate: "2026-01-01",
      endDate: "2027-06-30",
      quantity: "1",
      unitPrice: "12000",
    });
    const opts = { dateRange: { from: "2027-01-01", to: "2027-12-31" } };

    expect(getSpendByPublisher([promo], opts)[0].totalSpendByCurrency.EUR).toBe(3978.02);
    expect(getVendorTable([promo], opts)[0].totalSpendByCurrency.EUR).toBe(3978.02);
  });

  test("breaks calculated budget down by overview lifecycle status with PO fallback pricing", () => {
    const overview = getCostOverview([
      license({ id: 1, expirationStatus: "active", quantity: "4", unitPrice: "250", totalPoPrice: "20" }),
      license({ id: 2, expirationStatus: "perpetual", quantity: "", unitPrice: "", totalPoPrice: "500" }),
      license({ id: 3, expirationStatus: "expiring", quantity: "10", unitPrice: "25", totalPoPrice: "10" }),
      license({ id: 4, expirationStatus: "expired", quantity: "10", unitPrice: "5000", totalPoPrice: "382.40" }),
      license({ id: 5, expirationStatus: "renewed", quantity: "1", unitPrice: "900", totalPoPrice: "900" }),
    ]);

    expect(overview.lifecycleBudgetByStatus).toEqual({
      active: { EUR: 1500 },
      expiring: { EUR: 250 },
      expired: { EUR: 50000 },
    });
  });

  test("counts active separately from expiring and ignores non-report lifecycle states", () => {
    expect(getLifecycleCounts([
      license({ id: 1, expirationStatus: "active" }),
      license({ id: 2, expirationStatus: "perpetual" }),
      license({ id: 3, expirationStatus: "expiring" }),
      license({ id: 4, expirationStatus: "expired" }),
      license({ id: 5, expirationStatus: "renewed" }),
      license({ id: 6, expirationStatus: "legacy" }),
      license({ id: 7, expirationStatus: "upcoming" }),
    ])).toEqual({
      active: 2,
      upcoming: 1,
      expiring: 1,
      expired: 1,
    });
  });

  test("forecasts from active recurring records and excludes paid perpetual parents", () => {
    const currentYear = new Date().getFullYear();
    const licenses = [
      license({
        id: 1,
        licenseType: "perpetual",
        softwareDescription: "Perpetual Parent",
        totalPoPrice: "5000",
        quantity: "1",
        unitPrice: "5000",
        hasMaintenance: true,
        activeMaintenanceId: 2,
      }),
      license({
        id: 2,
        licenseType: "maintenance",
        softwareDescription: "Annual Maintenance",
        totalPoPrice: "5000",
        quantity: "1",
        unitPrice: "600",
        parentLicenseId: 1,
      }),
      license({
        id: 3,
        licenseType: "saas",
        softwareDescription: "SaaS Product",
        totalPoPrice: "1200",
        quantity: "12",
        unitPrice: "100",
      }),
      license({
        id: 4,
        licenseType: "subscription",
        softwareDescription: "Retired Subscription",
        quantity: "1",
        unitPrice: "999",
        isRetired: true,
      }),
    ];

    const forecast = getBudgetForecast(licenses, { years: 2, annualGrowthPct: 10 });

    expect(forecast.baselineByCurrency).toEqual({ EUR: 1800 });
    expect(forecast.singleCurrency).toBe("EUR");
    expect(forecast.recurringRecords.map((row) => row.id).sort()).toEqual([2, 3]);
    expect(forecast.forecastRows).toEqual([
      { year: currentYear + 1, baseline: 1800, growthAmount: 0, projectedBudget: 1800 },
      { year: currentYear + 2, baseline: 1800, growthAmount: 180, projectedBudget: 1980 },
    ]);
  });

  test("marks recurring records that must fall back to legacy stored PO pricing", () => {
    const forecast = getBudgetForecast([
      license({ id: 1, quantity: "", unitPrice: "", totalPoPrice: "900" }),
    ]);

    expect(forecast.baselineByCurrency).toEqual({ EUR: 900 });
    expect(forecast.fallbackCount).toBe(1);
    expect(forecast.recurringRecords[0].costSource).toBe("po_fallback");
  });

  test("excludes expired recurring records from the active forecast baseline", () => {
    const forecast = getBudgetForecast([
      license({ id: 1, expirationStatus: "active", quantity: "1", unitPrice: "300" }),
      license({ id: 2, expirationStatus: "expiring", quantity: "1", unitPrice: "200" }),
      license({ id: 3, expirationStatus: "expired", quantity: "1", unitPrice: "900" }),
    ]);

    expect(forecast.baselineByCurrency).toEqual({ EUR: 500 });
    expect(forecast.recurringRecords.map((row) => row.id).sort()).toEqual([1, 2]);
  });

  test("mixed currencies produce empty forecastRows and null singleCurrency", () => {
    const licenses = [
      license({ id: 1, currency: "EUR", quantity: "1", unitPrice: "500" }),
      license({ id: 2, currency: "USD", quantity: "1", unitPrice: "300" }),
    ];

    const forecast = getBudgetForecast(licenses);

    expect(forecast.singleCurrency).toBeNull();
    expect(forecast.forecastRows).toEqual([]);
    expect(forecast.baselineByCurrency).toEqual({ EUR: 500, USD: 300 });
  });

  test("mixed currencies group spend per currency in getCostOverview", () => {
    const licenses = [
      license({ id: 1, currency: "EUR", totalPoPrice: "1000", quantity: "10", unitPrice: "100" }),
      license({ id: 2, currency: "USD", totalPoPrice: "500", quantity: "5", unitPrice: "100", poNumber: "" }),
    ];

    const overview = getCostOverview(licenses);

    expect(overview.licenseSpendByCurrency).toEqual({ EUR: 1000, USD: 500 });
    expect(overview.poSpendByCurrency).toEqual({ EUR: 1000, USD: 500 });
    expect(overview.recurringAnnualCostByCurrency).toEqual({ EUR: 1000, USD: 500 });
  });

  test("counts records with no usable line pricing", () => {
    const overview = getCostOverview([
      license({ id: 1, quantity: "2", unitPrice: "50", totalPoPrice: "" }),
      license({ id: 2, quantity: "", unitPrice: "", totalPoPrice: "" }),
    ]);

    expect(overview.unpricedCount).toBe(1);
  });

  test("uses calculated value for publisher and supplier summaries", () => {
    const licenses = [
      license({
        id: 1,
        publisherName: "Perforce",
        supplier: "Reseller",
        quantity: "10",
        unitPrice: "5000",
        totalPoPrice: "382.40",
      }),
    ];

    expect(getSpendByPublisher(licenses)[0].totalSpendByCurrency).toEqual({ EUR: 50000 });
    expect(getVendorTable(licenses)[0].totalSpendByCurrency).toEqual({ EUR: 50000 });
  });
});

describe("report date-only handling", () => {
  test("this-year filtering keeps licenses that start on the first local day of the year", () => {
    withNegativeOffsetDateOnlyParsing(() => {
      const filtered = filterLicenses([
        license({ id: 1, startDate: "2026-01-01" }),
      ], { dateRange: "thisYear" });

      expect(filtered.map((item) => item.id)).toEqual([1]);
    });
  });

  test("renewal calendar counts date-only expiries on the first day of a quarter", () => {
    withNegativeOffsetDateOnlyParsing(() => {
      const quarters = getRenewalCalendar([
        license({
          id: 1,
          endDate: "2026-07-01",
          expirationStatus: "active",
          totalPoPrice: "1000",
          quantity: "",
          unitPrice: "",
        }),
      ], 1);

      const q3 = quarters.find((quarter) => quarter.quarterLabel === "Q3 2026");
      expect(q3.count).toBe(1);
    });
  });
});

describe("getRenewalCalendar fiscal year alignment", () => {
  function renewalLicense(endDate, overrides = {}) {
    return {
      id: 1,
      endDate,
      expirationStatus: "expiring",
      totalPoPrice: "1000",
      currency: "EUR",
      ...overrides,
    };
  }

  test("default (January) produces calendar quarters matching legacy behavior", () => {
    // Freeze time to Q2 2026 (May 2026)
    const realNow = Date;
    globalThis.Date = class extends realNow {
      constructor(...args) { if (args.length === 0) { super(2026, 4, 15); } else { super(...args); } }
      static now() { return new realNow(2026, 4, 15).getTime(); }
    };

    try {
      const quarters = getRenewalCalendar([], 1);
      expect(quarters.map(q => q.quarterLabel)).toEqual(["Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027"]);
    } finally {
      globalThis.Date = realNow;
    }
  });

  test("April fiscal year start produces fiscal quarters starting from current fiscal quarter", () => {
    // Freeze time to May 15, 2026 — that is FQ2 of an April fiscal year (Apr–Jun = FQ1, Jul–Sep = FQ2... wait)
    // April FY: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
    // May 2026 falls in Q1 (Apr-Jun 2026)
    const realNow = Date;
    globalThis.Date = class extends realNow {
      constructor(...args) { if (args.length === 0) { super(2026, 4, 15); } else { super(...args); } }
      static now() { return new realNow(2026, 4, 15).getTime(); }
    };

    try {
      const quarters = getRenewalCalendar([], 4);
      expect(quarters.map(q => q.quarterLabel)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2027"]);
      // Q1: Apr–Jun 2026; Q2: Jul–Sep 2026; Q3: Oct–Dec 2026; Q4: Jan–Mar 2027
      const boundaryQuarters = getRenewalCalendar([
        renewalLicense("2026-06-30", { id: 1 }),
        renewalLicense("2026-07-01", { id: 2 }),
        renewalLicense("2027-03-31", { id: 3 }),
        renewalLicense("2027-04-01", { id: 4 }),
      ], 4);
      expect(boundaryQuarters.map(q => q.count)).toEqual([1, 1, 0, 1]);
    } finally {
      globalThis.Date = realNow;
    }
  });

  test("a license expiring in the correct fiscal quarter is counted", () => {
    // Freeze to May 2026; fiscal year starts October
    // Oct FY: Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep
    // May 2026 falls in Q3 (Apr-Jun 2026)
    const realNow = Date;
    globalThis.Date = class extends realNow {
      constructor(...args) { if (args.length === 0) { super(2026, 4, 15); } else { super(...args); } }
      static now() { return new realNow(2026, 4, 15).getTime(); }
    };

    try {
      const lic = renewalLicense("2026-06-20"); // June 20 → should land in Q3 (Apr-Jun)
      const quarters = getRenewalCalendar([lic], 10);
      const q3 = quarters.find(q => q.quarterLabel === "Q3 2026");
      expect(q3).toBeDefined();
      expect(q3.count).toBe(1);
      expect(q3.estimatedValueByCurrency).toEqual({ EUR: 1000 });
      expect(q3.estimatedValue).toBe(1000);
    } finally {
      globalThis.Date = realNow;
    }
  });

  test("renewal estimated value uses calculated value before PO fallback", () => {
    const realNow = Date;
    globalThis.Date = class extends realNow {
      constructor(...args) { if (args.length === 0) { super(2026, 4, 15); } else { super(...args); } }
      static now() { return new realNow(2026, 4, 15).getTime(); }
    };

    try {
      const quarters = getRenewalCalendar([
        renewalLicense("2026-06-20", { quantity: "10", unitPrice: "5000", totalPoPrice: "382.40" }),
      ], 10);
      const q3 = quarters.find(q => q.quarterLabel === "Q3 2026");
      expect(q3.estimatedValueByCurrency).toEqual({ EUR: 50000 });
      expect(q3.estimatedValue).toBe(50000);
    } finally {
      globalThis.Date = realNow;
    }
  });
});

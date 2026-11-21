// Shared cases, also run by the server
// (backend/tests/test_unit/test_portfolio_stats_cases.py and test_completeness_cases.py),
// so the demo's statistics and completeness rules cannot drift from it unnoticed.
import { beforeEach, describe, expect, it } from "vitest";
import statsCases from "../../../../backend/tests/fixtures/portfolio_stats_cases.json";
import completenessCases from "../../../../backend/tests/fixtures/completeness_cases.json";
import { buildLicense } from "../fixtures.js";
import { computeLicenseCompletenessPct, computeStats, decorateLicense, resetStore, store } from "../store.js";
import { daysFromNow } from "../time.js";

const DATE_FIELDS = ["startDate", "endDate", "noticeDate", "maintenanceStartDate", "maintenanceEndDate"];

// Case dates are whole-day offsets from today.
function caseLicense(fields, defaults) {
  const license = { id: 1, ...defaults, ...fields };
  for (const field of DATE_FIELDS) {
    if (license[field] != null) license[field] = daysFromNow(license[field]);
  }
  return buildLicense(license);
}

const twoDecimals = (amounts) => Object.fromEntries(
  Object.entries(amounts).map(([currency, amount]) => [currency, Number(amount).toFixed(2)]),
);

describe("shared portfolio statistics cases", () => {
  beforeEach(() => resetStore());

  it.each(statsCases.cases.map((c) => [c.name, c]))("%s", (_name, c) => {
    store.globalSettings.mandatory_fields = c.mandatory_fields ?? {};
    store.licenses = c.licenses.map((fields) => caseLicense(fields, statsCases.license_defaults));
    store.licenses.forEach(decorateLicense);

    const stats = computeStats();

    for (const [key, expected] of Object.entries(c.expected)) {
      const actual = key === "annual_cost_by_currency" ? twoDecimals(stats[key]) : stats[key];
      expect({ [key]: actual }).toEqual({ [key]: expected });
    }
  });
});

describe("shared completeness cases", () => {
  beforeEach(() => resetStore());

  it.each(completenessCases.cases.map((c) => [c.name, c]))("%s", (_name, c) => {
    store.globalSettings.mandatory_fields = c.mandatory_fields;
    const license = caseLicense(c.license, completenessCases.license_defaults);
    license.documents = c.documents.map((category) => ({ category }));

    expect(computeLicenseCompletenessPct(license)).toBe(c.expected);
  });
});

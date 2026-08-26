import { afterEach, describe, expect, test, vi } from "vitest";

import { exportDetailedReport, getDetailedReport, normalizeDetailedReport } from "../api/reports.js";
import * as client from "../api/client.js";
import { formatSignedCostByCurrency } from "../utils/helpers.js";

vi.mock("../api/client.js", () => ({
  get: vi.fn(),
}));

const filters = {
  includeRetired: true,
  dateRange: "custom",
  dateFrom: "2026-01-01",
  dateTo: "2026-12-31",
  costCentres: ["IT"],
  forecastYears: 3,
  forecastGrowthPct: 2.5,
  fiscalYearStartMonth: 4,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reports API", () => {
  test("normalizes canonical decimal strings without dropping signed differences", () => {
    const normalized = normalizeDetailedReport({
      financialSummaries: { spendDifferenceByCurrency: { EUR: "-50.25", USD: "10" } },
      costOverview: { spendDifferenceByCurrency: { EUR: "-50.25", USD: "10" } },
      budgetForecast: {},
      portfolioData: { byType: [{ name: "saas", value: 2 }], byMetric: [{ name: "per_user", value: 2 }] },
    });

    expect(normalized.costOverview.spendDifferenceByCurrency).toEqual({ EUR: -50.25, USD: 10 });
    expect(normalized.portfolioData).toEqual({
      byType: [{ name: "SaaS", value: 2 }],
      byMetric: [{ name: "Per User", value: 2 }],
    });
    expect(formatSignedCostByCurrency({ EUR: -50.25, USD: 10 }, "en-US")).toContain("-€50.25");
  });

  test("sends every detailed-report filter to the backend", async () => {
    client.get.mockResolvedValueOnce({
      data: { financialSummaries: {}, costOverview: {}, budgetForecast: {} },
      error: null,
    });

    await getDetailedReport(filters);

    const path = client.get.mock.calls[0][0];
    expect(path).toContain("/api/reports/detailed?");
    expect(path).toContain("include_retired=true");
    expect(path).toContain("date_range=custom");
    expect(path).toContain("date_from=2026-01-01");
    expect(path).toContain("date_to=2026-12-31");
    expect(path).toContain("cost_centres=IT");
    expect(path).toContain("forecast_years=3");
    expect(path).toContain("annual_uplift_pct=2.5");
    expect(path).toContain("fiscal_year_start_month=4");
  });

  test("downloads the report-specific CSV response", async () => {
    const response = new Response("Report Type,Amount\r\nsummary,10\r\n", {
      headers: { "Content-Type": "text/csv" },
    });
    const anchor = document.createElement("a");
    const click = vi.spyOn(anchor, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValueOnce(anchor);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:report"),
      revokeObjectURL: vi.fn(),
    });
    client.get.mockResolvedValueOnce({ data: response, error: null });

    await expect(exportDetailedReport(filters)).resolves.toEqual({ data: null, error: null });
    expect(click).toHaveBeenCalledTimes(1);
  });
});

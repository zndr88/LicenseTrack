import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ReportsPage from "../components/pages/ReportsPage.jsx";
import { getLicenses } from "../api/licenses.js";
import { exportDetailedReport, getDetailedReport, getPortfolioStats } from "../api/reports.js";
import { queryKeys } from "../queryKeys.js";
import { normalizeLicense } from "../utils/helpers.js";
import {
  filterLicenses,
  getBudgetForecast,
  getCostOverview,
  getLifecycleCounts,
  getPerpetualMaintenanceReport,
  getPortfolioBreakdown,
  getPurchaseOrderReport,
  getRenewalCalendar,
  getSpendByPublisher,
  getVendorTable,
} from "../utils/reportHelpers.js";

vi.mock("recharts", () => {
  const passthrough = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    Bar: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    CartesianGrid: passthrough,
    Tooltip: passthrough,
    Cell: passthrough,
    PieChart: passthrough,
    Pie: passthrough,
  };
});

vi.mock("../api/licenses.js", () => ({
  getLicenses: vi.fn(),
}));

vi.mock("../api/reports.js", () => ({
  exportDetailedReport: vi.fn(),
  getDetailedReport: vi.fn(),
  getPortfolioStats: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: () => <span />,
}));

const userSettings = {
  displayCurrency: "EUR",
  numberFormatLocale: "en-US",
};
const LAZY_SECTION_TIMEOUT = { timeout: 10_000 };

function renderReportsPage({ configureQueryClient, ...props } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  configureQueryClient?.(queryClient);

  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage userSettings={userSettings} onError={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

function license(overrides = {}) {
  return {
    id: 1,
    publisherName: "Acme",
    softwareDescription: "Acme Suite",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    unitPrice: "100",
    totalPoPrice: "1000",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    supplier: "Acme Supplier",
    costCentre: "IT",
    isRetired: false,
    budgetOwnerEmail: "owner@example.com",
    ...overrides,
  };
}

let reportLicenseResult;

async function buildDetailedReport(filters) {
  reportLicenseResult ??= getLicenses({ includeRetired: true });
  const { data, error } = await reportLicenseResult;
  if (error) throw new Error(error);
  const licenses = (data ?? []).map(normalizeLicense);
  const effectiveRange = filters.dateRange === "custom"
    ? { from: filters.dateFrom, to: filters.dateTo }
    : filters.dateRange;
  const filtered = filterLicenses(licenses, {
    includeRetired: filters.includeRetired,
    dateRange: effectiveRange,
    costCentres: filters.costCentres,
  });
  const costOverview = getCostOverview(filtered, { dateRange: effectiveRange });
  return {
    counts: {
      records: filtered.length,
      totalRecords: licenses.length,
      unpriced: costOverview.unpricedCount,
      excluded: costOverview.excludedCount,
      ...getLifecycleCounts(filtered),
    },
    availableCostCentres: [...new Set(licenses.map((item) => item.costCentre).filter(Boolean))].sort(),
    costOverview,
    budgetForecast: getBudgetForecast(filtered, {
      years: filters.forecastYears,
      annualGrowthPct: filters.forecastGrowthPct,
    }),
    publisherData: getSpendByPublisher(filtered, { dateRange: effectiveRange }),
    vendorData: getVendorTable(filtered, { dateRange: effectiveRange }),
    portfolioData: getPortfolioBreakdown(filtered),
    renewalData: getRenewalCalendar(filtered, filters.fiscalYearStartMonth),
    purchaseOrderData: getPurchaseOrderReport(filtered, { dateRange: effectiveRange }),
    perpetualMaintenanceData: getPerpetualMaintenanceReport(filtered),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reportLicenseResult = null;
  window.sessionStorage.clear();
  getDetailedReport.mockImplementation(buildDetailedReport);
  exportDetailedReport.mockResolvedValue({ data: null, error: null });
  getPortfolioStats.mockResolvedValue({
    total_active: 2,
    total_expiring: 1,
    total_expired: 0,
    total_incomplete: 0,
    annual_cost_by_currency: { EUR: 2000 },
    excluded_from_totals: 0,
    by_license_type: [],
  });
});

describe("ReportsPage interactions", () => {
  test("labels missing and invalid pricing separately in the portfolio summary", async () => {
    getDetailedReport.mockResolvedValueOnce({
      counts: { records: 3, totalRecords: 3, active: 3, upcoming: 0, expiring: 0, expired: 0, unpriced: 3, excluded: 1 },
      availableCostCentres: [],
      costOverview: {},
      budgetForecast: { forecastRows: [], recurringRecords: [], baselineByCurrency: {}, singleCurrency: null },
    });
    getPortfolioStats.mockResolvedValueOnce({ excluded_from_totals: 9, annual_cost_by_currency: {} });

    renderReportsPage();

    expect(await screen.findByText("3 unpriced")).toBeInTheDocument();
    expect(screen.getByText("1 invalid price")).toBeInTheDocument();
    expect(screen.queryByText(/0 excluded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/9 excluded/i)).not.toBeInTheDocument();
  });

  test("loads the report portfolio with retired licenses included", async () => {
    getLicenses.mockResolvedValueOnce({ data: [], error: null });

    renderReportsPage();

    await waitFor(() => {
      expect(getLicenses).toHaveBeenCalledWith({ includeRetired: true });
    });
  });

  test("shows license loading failures instead of empty report sections", async () => {
    const onError = vi.fn();
    getLicenses.mockResolvedValueOnce({ data: null, error: "License load failed" });

    renderReportsPage({ onError });

    expect(await screen.findByText("License load failed")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("License load failed");
    expect(screen.queryByText("No data available for the current filters")).not.toBeInTheDocument();
  });

  test("loads report annual cost independently from sidebar portfolio stats", async () => {
    getLicenses.mockResolvedValueOnce({ data: [], error: null });

    renderReportsPage({
      configureQueryClient: (queryClient) => {
        queryClient.setQueryData(queryKeys.portfolioStats, {
          active: 90,
          pending: 1,
          expiring: 0,
          expired: 2,
          renewed: 15,
        });
      },
    });

    expect(await screen.findByText("€2,000.00")).toBeInTheDocument();
    expect(getPortfolioStats).toHaveBeenCalledTimes(1);
  });

  test("collapses and reopens report sections without changing their data", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({ data: [license()], error: null });

    renderReportsPage();

    const section = await screen.findByRole("button", { name: /Cost Overview & Forecast/ }, LAZY_SECTION_TIMEOUT);
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Spend by PO Value")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(Cost Overview|Publisher & Vendor|Portfolio Breakdown|Renewal Calendar)/ }))
      .toHaveLength(4);

    await user.click(section);
    expect(section).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Spend by License", {}, LAZY_SECTION_TIMEOUT)).toBeInTheDocument();
    expect(await screen.findByText("Spend by PO Value", {}, LAZY_SECTION_TIMEOUT)).toBeInTheDocument();

    await user.click(section);
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Spend by PO Value")).not.toBeInTheDocument();
  }, 15_000);

  test("shows license spend and overridden PO spend as separate totals", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: [
        license({ id: 1, poNumber: "PO-OVERRIDE", quantity: "1", unitPrice: "0", poTotalOverride: "1250" }),
        license({ id: 2, poNumber: "PO-OVERRIDE", quantity: "2", unitPrice: "0", poTotalOverride: "1250" }),
      ],
      error: null,
    });

    renderReportsPage();

    await user.click(await screen.findByRole("button", { name: /Cost Overview & Forecast/ }, LAZY_SECTION_TIMEOUT));
    const licenseMetric = (await screen.findByText("Spend by License", {}, LAZY_SECTION_TIMEOUT)).parentElement;
    const poMetric = (await screen.findByText("Spend by PO Value", {}, LAZY_SECTION_TIMEOUT)).parentElement;
    const differenceMetric = (await screen.findByText("Difference", {}, LAZY_SECTION_TIMEOUT)).parentElement;

    expect(within(licenseMetric).getByText("€0.00")).toBeInTheDocument();
    expect(within(poMetric).getByText("€1,250.00")).toBeInTheDocument();
    expect(within(differenceMetric).getByText("€1,250.00")).toBeInTheDocument();
    expect(screen.getByText(/included in PO-value spend but excluded from license breakdowns and forecasts/i)).toBeInTheDocument();
  }, 15_000);

  test("filters by cost centre and warns when visible rows use mixed currencies", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: [
        license({ id: 1, publisherName: "Euro Publisher", costCentre: "IT", currency: "EUR" }),
        license({ id: 2, publisherName: "Dollar Publisher", costCentre: "Finance", currency: "USD" }),
      ],
      error: null,
    });

    renderReportsPage();

    await screen.findByText("Publisher & Vendor Overview", {}, LAZY_SECTION_TIMEOUT);
    await user.click(screen.getByRole("button", { name: /Publisher & Vendor Overview/ }));
    expect(await screen.findAllByText("Euro Publisher", {}, { timeout: 5_000 })).not.toHaveLength(0);
    expect(screen.getByText("Publisher & Vendor Overview")).toBeInTheDocument();
    expect(screen.queryByText("Spend by Publisher")).not.toBeInTheDocument();
    expect(screen.queryByText("Vendor Overview")).not.toBeInTheDocument();
    expect(screen.getByText(/Amounts shown in native currencies/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 licenses/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All departments/i }));
    await user.click(within(screen.getByRole("listbox")).getByText("Finance"));

    expect(await screen.findByText(/Showing 1 license/i)).toBeInTheDocument();
    expect(screen.getAllByText("Dollar Publisher")).not.toHaveLength(0);
    expect(screen.queryByText("Euro Publisher")).not.toBeInTheDocument();
  });

  test("searches large department lists inside the reports filter dropdown", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: Array.from({ length: 30 }, (_, index) => license({
        id: index + 1,
        publisherName: `Publisher ${index + 1}`,
        costCentre: `Department ${String(index + 1).padStart(3, "0")}`,
      })),
      error: null,
    });

    renderReportsPage();

    await screen.findByText("Publisher & Vendor Overview", {}, LAZY_SECTION_TIMEOUT);
    await user.click(screen.getByRole("button", { name: /Publisher & Vendor Overview/ }));
    expect(await screen.findAllByText("Publisher 1")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /All departments/i }));

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Department 001")).toBeInTheDocument();
    await user.type(within(listbox).getByLabelText("Search departments"), "029");

    expect(within(listbox).getByText("Department 029")).toBeInTheDocument();
    expect(within(listbox).queryByText("Department 001")).not.toBeInTheDocument();
    expect(listbox.querySelector(".report-dept-options")).toBeInTheDocument();

    await user.click(within(listbox).getByText("Department 029"));
    expect(await screen.findByText(/Showing 1 license/i)).toBeInTheDocument();
    expect(screen.getAllByText("Publisher 29")).not.toHaveLength(0);
  });

  test("searches detailed publisher and supplier cost rows", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: [
        license({ id: 1, publisherName: "Alpha Publisher", supplier: "North Supplier" }),
        license({ id: 2, publisherName: "Beta Publisher", supplier: "South Supplier" }),
      ],
      error: null,
    });

    renderReportsPage();

    await screen.findByText("Publisher & Vendor Overview", {}, LAZY_SECTION_TIMEOUT);
    await user.click(screen.getByRole("button", { name: /Publisher & Vendor Overview/ }));
    const search = screen.getByLabelText("Search publisher and supplier table");
    expect(screen.getByText("2 rows")).toBeInTheDocument();

    await user.type(search, "North");
    expect(screen.getByText("North Supplier")).toBeInTheDocument();
    expect(screen.queryByText("South Supplier")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("South Supplier")).toBeInTheDocument();
  });

  test("updates lifecycle counters from filtered rows and omits incomplete", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: [
        license({ id: 1, costCentre: "DEVOPS", expirationStatus: "active" }),
        license({ id: 2, costCentre: "DEVOPS", expirationStatus: "perpetual" }),
        license({ id: 3, costCentre: "DEVOPS", expirationStatus: "expiring" }),
        license({ id: 4, costCentre: "DEVOPS", expirationStatus: "expired" }),
        license({ id: 5, costCentre: "Finance", expirationStatus: "active" }),
        license({ id: 6, costCentre: "Finance", expirationStatus: "upcoming" }),
      ],
      error: null,
    });

    renderReportsPage();

    expect(await screen.findByLabelText("Active: 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Upcoming: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Expiring: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Expired: 1")).toBeInTheDocument();
    expect(screen.queryByText("Incomplete")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All departments/i }));
    await user.click(within(screen.getByRole("listbox")).getByText("DEVOPS"));

    expect(await screen.findByLabelText("Active: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Upcoming: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Expiring: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Expired: 1")).toBeInTheDocument();
  });

  test("clamps forecast controls to supported ranges", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({
      data: [license({ id: 1, totalPoPrice: "1200", unitPrice: "100" })],
      error: null,
    });

    renderReportsPage();

    await screen.findByText("Cost Overview & Forecast", {}, LAZY_SECTION_TIMEOUT);
    await user.click(screen.getByRole("button", { name: /Cost Overview & Forecast/ }));
    expect(await screen.findByLabelText(/Years/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Report date range")).toHaveValue("all");
    const yearsInput = screen.getByLabelText(/Years/i);
    const upliftInput = screen.getByLabelText(/Annual uplift/i);

    await user.clear(yearsInput);
    await user.type(yearsInput, "99");
    expect(yearsInput).toHaveValue(10);

    await user.clear(upliftInput);
    await user.type(upliftInput, "150");
    expect(upliftInput).toHaveValue(100);
  });

  test("validates custom date ranges before calculating report data", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({ data: [license()], error: null });

    renderReportsPage();

    await screen.findByText("Cost Overview & Forecast", {}, LAZY_SECTION_TIMEOUT);
    await user.selectOptions(screen.getByLabelText("Report date range"), "custom");
    expect(screen.getByRole("alert")).toHaveTextContent("Select both a start and end date.");

    await user.type(screen.getByLabelText("Report start date"), "2026-12-31");
    await user.type(screen.getByLabelText("Report end date"), "2026-01-01");
    const errorMessage = "The start date must be before the end date.";
    expect(screen.getByRole("alert")).toHaveTextContent(errorMessage);
    expect(screen.getAllByText(errorMessage)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Export filtered report/i })).toBeDisabled();
    expect(screen.queryByText("Spend by PO Value")).not.toBeInTheDocument();
  });

  test("clears active report filters", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({ data: [license()], error: null });

    renderReportsPage();

    await screen.findByText("Cost Overview & Forecast", {}, LAZY_SECTION_TIMEOUT);
    await user.selectOptions(screen.getByLabelText("Report date range"), "custom");
    await user.type(screen.getByLabelText("Report start date"), "2026-01-01");
    await user.type(screen.getByLabelText("Report end date"), "2026-12-31");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Report date range")).toHaveValue("all");
    expect(screen.queryByLabelText("Report start date")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 license")).toBeInTheDocument();
  });

  test("restores collapsed report sections during the session", async () => {
    const user = userEvent.setup();
    getLicenses.mockResolvedValueOnce({ data: [license()], error: null });

    const firstRender = renderReportsPage();
    const section = await screen.findByRole("button", { name: /Cost Overview & Forecast/ }, LAZY_SECTION_TIMEOUT);
    await user.click(section);
    firstRender.unmount();

    getLicenses.mockResolvedValueOnce({ data: [license()], error: null });
    renderReportsPage();

    const restoredSection = await screen.findByRole("button", { name: /Cost Overview & Forecast/ }, LAZY_SECTION_TIMEOUT);
    expect(restoredSection).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Spend by PO Value")).toBeInTheDocument();
  });
});

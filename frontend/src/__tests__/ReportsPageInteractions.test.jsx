import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ReportsPage from "../components/pages/ReportsPage.jsx";
import { getLicenses } from "../api/licenses.js";
import { getPortfolioStats } from "../api/reports.js";
import { queryKeys } from "../queryKeys.js";

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
  getPortfolioStats: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: () => <span />,
}));

const userSettings = {
  displayCurrency: "EUR",
  numberFormatLocale: "en-US",
};

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

beforeEach(() => {
  vi.clearAllMocks();
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
});

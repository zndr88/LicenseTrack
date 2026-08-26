import { get } from "./client.js";
import { LICENSE_METRICS, LICENSE_TYPES } from "../constants/licenseData.js";

const TYPE_LABELS = Object.fromEntries(LICENSE_TYPES.map(({ value, label }) => [value, label]));
const METRIC_LABELS = Object.fromEntries(LICENSE_METRICS.map(({ value, label }) => [value, label]));

function amountMap(values) {
  return Object.fromEntries(Object.entries(values ?? {}).map(([currency, value]) => [currency, Number(value)]));
}

function amountRow(row, fields) {
  const result = { ...row };
  for (const field of fields) {
    if (result[field] !== null && result[field] !== undefined && result[field] !== "") {
      result[field] = Number(result[field]);
    }
  }
  return result;
}

/** Normalize the server's canonical decimal strings for presentation only. */
export function normalizeDetailedReport(report) {
  if (!report) return report;
  const summary = report.financialSummaries ?? {};
  const costOverview = report.costOverview ?? {};
  const budget = report.budgetForecast ?? {};
  const normalizeSummary = (value) => ({
    ...value,
    licenseSpendByCurrency: amountMap(value.licenseSpendByCurrency),
    poSpendByCurrency: amountMap(value.poSpendByCurrency),
    spendDifferenceByCurrency: amountMap(value.spendDifferenceByCurrency),
    recurringAnnualCostByCurrency: amountMap(value.recurringAnnualCostByCurrency),
    unallocatedValuesByCurrency: amountMap(value.unallocatedValuesByCurrency),
    lifecycleBudgetByStatus: Object.fromEntries(Object.entries(value.lifecycleBudgetByStatus ?? {}).map(([key, amounts]) => [key, amountMap(amounts)])),
  });
  return {
    ...report,
    financialSummaries: normalizeSummary(summary),
    costOverview: {
      ...normalizeSummary(costOverview),
    },
    budgetForecast: {
      ...budget,
      baselineByCurrency: amountMap(budget.baselineByCurrency),
      forecastRows: (budget.forecastRows ?? []).map((row) => amountRow(row, ["baseline", "growthAmount", "projectedBudget"])),
      recurringRecords: (budget.recurringRecords ?? []).map((row) => amountRow(row, ["annualCost"])),
    },
    publisherData: (report.publisherData ?? []).map((row) => ({ ...row, totalSpendByCurrency: amountMap(row.totalSpendByCurrency), totalSpend: Number(row.totalSpend ?? 0) })),
    vendorData: (report.vendorData ?? []).map((row) => ({ ...row, totalSpendByCurrency: amountMap(row.totalSpendByCurrency), totalSpend: Number(row.totalSpend ?? 0) })),
    renewalData: (report.renewalData ?? []).map((quarter) => ({
      ...quarter,
      estimatedValueByCurrency: amountMap(quarter.estimatedValueByCurrency),
      estimatedValue: Object.values(quarter.estimatedValueByCurrency ?? {}).reduce((sum, value) => sum + Number(value), 0),
      events: (quarter.events ?? []).map((row) => amountRow(row, ["renewalValue"])),
    })),
    portfolioData: {
      byType: (report.portfolioData?.byType ?? []).map((row) => ({ ...row, name: TYPE_LABELS[row.name] ?? row.name })),
      byMetric: (report.portfolioData?.byMetric ?? []).map((row) => ({ ...row, name: METRIC_LABELS[row.name] ?? row.name })),
    },
    perpetualMaintenanceData: {
      ...(report.perpetualMaintenanceData ?? {}),
      purchaseByCurrency: amountMap(report.perpetualMaintenanceData?.purchaseByCurrency),
      maintenanceByCurrency: amountMap(report.perpetualMaintenanceData?.maintenanceByCurrency),
      totalByCurrency: amountMap(report.perpetualMaintenanceData?.totalByCurrency),
      rows: (report.perpetualMaintenanceData?.rows ?? []).map((row) => ({
        ...row,
        id: row.licenseId,
        purchaseValue: Number(row.purchaseValue ?? 0),
        maintenanceByCurrency: amountMap(row.maintenanceByCurrency),
        maintenanceRecords: (row.maintenanceRecords ?? []).map((record) => ({ ...record, id: record.licenseId, amount: Number(record.amount ?? 0) })),
      })),
    },
    purchaseOrderData: {
      ...(report.purchaseOrderData ?? {}),
      totalsByCurrency: amountMap(report.purchaseOrderData?.totalsByCurrency),
      lineTotalsByCurrency: amountMap(report.purchaseOrderData?.lineTotalsByCurrency),
      rows: (report.purchaseOrderData?.rows ?? []).map((row) => amountRow(row, ["poValue", "lineValue", "difference"])),
    },
  };
}

function reportQuery(filters = {}) {
  const params = new URLSearchParams();
  params.set("include_retired", String(Boolean(filters.includeRetired)));
  params.set("date_range", filters.dateRange || "all");
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  for (const costCentre of filters.costCentres ?? []) params.append("cost_centres", costCentre);
  params.set("forecast_years", String(filters.forecastYears ?? 5));
  params.set("annual_uplift_pct", String(filters.forecastGrowthPct ?? 0));
  params.set("fiscal_year_start_month", String(filters.fiscalYearStartMonth ?? 1));
  return `?${params.toString()}`;
}

/**
 * Fetch server-side portfolio summary statistics.
 *
 * Returns total_active, total_upcoming, total_expiring, total_expired, total_incomplete,
 * annual_cost_by_currency, excluded_from_totals, and by_license_type breakdown.
 *
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function getPortfolioStats() {
  const { data, error } = await get("/api/reports/portfolio-stats");
  if (error) throw new Error(error);
  return data;
}

export async function getDetailedReport(filters) {
  const { data, error } = await get(`/api/reports/detailed${reportQuery(filters)}`);
  if (error) throw new Error(error);
  return normalizeDetailedReport(data);
}

export async function exportDetailedReport(filters) {
  const { data: response, error } = await get(`/api/reports/detailed/export${reportQuery(filters)}`);
  if (error || !response) return { data: null, error: error ?? "Report CSV export failed" };
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "licensetrack_report.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { data: null, error: null };
}

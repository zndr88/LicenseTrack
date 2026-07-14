import React, { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  filterLicenses,
  getBudgetForecast,
  getCostOverview,
  getLifecycleCounts,
  getSpendByPublisher,
  getPortfolioBreakdown,
  getRenewalCalendar,
  getVendorTable,
} from "../../utils/reportHelpers.js";
import { normalizeLicense, formatCostByCurrency } from "../../utils/helpers.js";
import { getLicenses } from "../../api/licenses.js";
import { getPortfolioStats } from "../../api/reports.js";
import Toggle from "../ui/Toggle.jsx";
import Icon from "../ui/Icon.jsx";
import CostCentreDropdown from "../reports/CostCentreDropdown.jsx";
import { queryKeys } from "../../queryKeys.js";

const loadReportSections = () => import("../reports/ReportSections.jsx");
const ReportSections = lazy(loadReportSections);

export default function ReportsPage({ userSettings, globalSettings, onError }) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const fiscalYearStartMonth = globalSettings?.fiscalYearStartMonth ?? 1;

  const [rawLicenses, setRawLicenses] = useState([]);
  const [licensesLoading, setLicensesLoading] = useState(true);
  const [licensesError, setLicensesError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLicensesLoading(true);
    setLicensesError(null);

    getLicenses({ includeRetired: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLicensesError(error);
          onError?.(error);
          return;
        }
        setRawLicenses((data ?? []).map(normalizeLicense));
      })
      .catch(() => {
        if (cancelled) return;
        const message = "Unable to load report license data";
        setLicensesError(message);
        onError?.(message);
      })
      .finally(() => {
        if (!cancelled) setLicensesLoading(false);
      });

    return () => { cancelled = true; };
  }, [onError]);

  // Server-side summary stats
  const { data: portfolioStats } = useQuery({
    queryKey: queryKeys.reportsPortfolioStats,
    queryFn: getPortfolioStats,
    staleTime: 60_000,
  });

  // Filters
  const [includeRetired, setIncludeRetired] = useState(false);
  const [dateRange, setDateRange] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedCostCentres, setSelectedCostCentres] = useState([]);
  const [forecastYears, setForecastYears] = useState(5);
  const [forecastGrowthPct, setForecastGrowthPct] = useState(0);

  // Export state
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void loadReportSections();
  }, []);

  // Available cost centres
  const costCentres = useMemo(() => {
    const vals = new Set();
    for (const l of rawLicenses) {
      if (l.costCentre) vals.add(l.costCentre);
    }
    return Array.from(vals).sort();
  }, [rawLicenses]);

  // Effective date range
  const effectiveDateRange = useMemo(() => {
    if (dateRange === "custom") {
      if (customFrom && customTo) return { from: customFrom, to: customTo };
      return "all";
    }
    return dateRange;
  }, [dateRange, customFrom, customTo]);

  // Filtered set
  const filtered = useMemo(() => filterLicenses(rawLicenses, {
    includeRetired,
    dateRange: effectiveDateRange,
    costCentres: selectedCostCentres,
  }), [rawLicenses, includeRetired, effectiveDateRange, selectedCostCentres]);

  // Currency helpers
  // singleCurrency is non-null only when all filtered licenses share one currency
  const singleCurrency = useMemo(() => {
    const currencies = new Set(filtered.map((l) => l.currency).filter(Boolean));
    return currencies.size === 1 ? [...currencies][0] : null;
  }, [filtered]);

  const hasMixedCurrencies = useMemo(() => {
    const currencies = new Set(filtered.map((l) => l.currency).filter(Boolean));
    return currencies.size > 1;
  }, [filtered]);

  // Section data
  const costOverview = useMemo(() => getCostOverview(filtered), [filtered]);
  const lifecycleCounts = useMemo(() => getLifecycleCounts(filtered), [filtered]);
  const budgetForecast = useMemo(() => getBudgetForecast(filtered, {
    years: forecastYears,
    annualGrowthPct: forecastGrowthPct,
  }), [filtered, forecastYears, forecastGrowthPct]);
  const publisherData = useMemo(() => getSpendByPublisher(filtered), [filtered]);
  const portfolioData = useMemo(() => getPortfolioBreakdown(filtered), [filtered]);
  const renewalData = useMemo(() => getRenewalCalendar(filtered, fiscalYearStartMonth), [filtered, fiscalYearStartMonth]);
  const vendorData = useMemo(() => getVendorTable(filtered), [filtered]);

  // Export all sections
  async function handleExportAll() {
    setExporting(true);
    try {
      const { exportFullReportPdf } = await import("../../utils/pdfExport.js");
      await exportFullReportPdf([
        { elementId: "report-section-cost-forecast", title: "Cost Overview & Forecast" },
        { elementId: "report-section-publisher-vendor", title: "Publisher & Vendor Overview" },
        { elementId: "report-section-portfolio", title: "Portfolio Breakdown" },
        { elementId: "report-section-renewal",   title: "Renewal Calendar" },
      ], "license-lifecycle-full-report", userSettings);
    } catch {
      if (onError) onError("PDF export failed — try again");
    } finally {
      setExporting(false);
    }
  }

  // Status line
  const statusLine = useMemo(() => {
    if (licensesLoading) return "Loading report data";
    if (licensesError) return "Report data unavailable";
    const base = `Showing ${filtered.length} license${filtered.length !== 1 ? "s" : ""}`;
    if (selectedCostCentres.length > 0) {
      return `${base} · ${selectedCostCentres.length} department${selectedCostCentres.length !== 1 ? "s" : ""} selected`;
    }
    return base;
  }, [filtered.length, selectedCostCentres, licensesLoading, licensesError]);

  // Render
  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2>Reports</h2>
            <p>Read-only analytics across your license portfolio</p>
          </div>
          <button
            onClick={handleExportAll}
            disabled={exporting}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 16px",
              background: "var(--accent)", border: "none", borderRadius: "var(--r)",
              color: "white", fontSize: 13, fontWeight: 600,
              cursor: exporting ? "not-allowed" : "pointer",
              opacity: exporting ? 0.6 : 1, flexShrink: 0,
            }}
          >
            <Icon name="download" size={14} color="white" />
            {exporting ? "Generating PDF..." : "Export Full Report (PDF)"}
          </button>
        </div>

        {/* Filter bar */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Include retired */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: "var(--r)", fontSize: 12, fontWeight: 500,
          }}>
            <span style={{ color: "var(--text-2)" }}>Include retired</span>
            <Toggle value={includeRetired} onChange={setIncludeRetired} />
          </div>

          {/* Date range */}
          <div className="chip">
            <Icon name="filter" size={12} />
            <select
              aria-label="Start date range"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              style={{ background: "none", border: "none", color: "inherit", fontFamily: "inherit", fontSize: "inherit", outline: "none", cursor: "pointer" }}
            >
              <option value="all">All start dates</option>
              <option value="thisYear">Started this year</option>
              <option value="last12">Started in last 12 months</option>
              <option value="custom">Custom start-date range</option>
            </select>
          </div>

          {dateRange === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "6px 10px", fontSize: 12, outline: "none" }}
              />
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "6px 10px", fontSize: 12, outline: "none" }}
              />
            </>
          )}

          {/* Cost centre multi-select */}
          <CostCentreDropdown
            costCentres={costCentres}
            selected={selectedCostCentres}
            onChange={setSelectedCostCentres}
          />

          <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 4 }}>
            {statusLine}
          </span>
        </div>

        {hasMixedCurrencies && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="alert" size={11} color="var(--orange)" />
            Amounts shown in native currencies — no conversion applied
          </div>
        )}
      </div>

      {/* Server-side summary stats */}
      <div style={{
          display: "flex", gap: 10, flexWrap: "wrap", padding: "12px 20px",
          borderBottom: "1px solid var(--border)", background: "var(--bg-2)",
        }}>
          {[
            { label: "Upcoming", value: licensesLoading || licensesError ? "-" : lifecycleCounts.upcoming, color: "var(--steel-text)" },
            { label: "Active", value: licensesLoading || licensesError ? "—" : lifecycleCounts.active, color: "var(--green)" },
            { label: "Expiring", value: licensesLoading || licensesError ? "—" : lifecycleCounts.expiring, color: "var(--orange)" },
            { label: "Expired", value: licensesLoading || licensesError ? "—" : lifecycleCounts.expired, color: "var(--red)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)",
              fontSize: 12,
            }} aria-label={`${label}: ${value}`}>
              <span style={{ color: "var(--text-2)" }}>{label}</span>
              <span style={{ fontWeight: 700, color }}>{value ?? "—"}</span>
            </div>
          ))}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)",
            fontSize: 12, marginLeft: "auto",
          }}>
            <span style={{ color: "var(--text-2)" }}>Portfolio annual cost</span>
            <span style={{ fontWeight: 700, color: "var(--text)", fontFamily: "var(--mono)" }}>
              {portfolioStats?.annual_cost_by_currency && Object.keys(portfolioStats.annual_cost_by_currency).length > 0
                ? formatCostByCurrency(portfolioStats.annual_cost_by_currency, locale)
                : "—"}
            </span>
            {portfolioStats?.excluded_from_totals > 0 && (
              <span style={{ fontSize: 11, color: "var(--orange)", display: "flex", alignItems: "center", gap: 3 }}>
                <Icon name="alert" size={11} color="var(--orange)" />
                {portfolioStats.excluded_from_totals} excluded
              </span>
            )}
          </div>
      </div>

      {/* Page content */}
      <div className="page-content">
        {licensesLoading ? (
          <div className="lp-loading">
            <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
            Loading report data...
          </div>
        ) : licensesError ? (
          <div className="lp-error">
            <Icon name="alert" size={16} color="var(--red-text)" />
            <span>{licensesError}</span>
          </div>
        ) : (
          <Suspense fallback={(
            <div className="lp-loading">
              <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
              Loading report sections...
            </div>
          )}>
            <ReportSections
              filteredCount={filtered.length}
              costOverview={costOverview}
              budgetForecast={budgetForecast}
              forecastYears={forecastYears}
              forecastGrowthPct={forecastGrowthPct}
              onForecastYearsChange={setForecastYears}
              onForecastGrowthPctChange={setForecastGrowthPct}
              locale={locale}
              singleCurrency={singleCurrency}
              publisherData={publisherData}
              vendorData={vendorData}
              portfolioData={portfolioData}
              renewalData={renewalData}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

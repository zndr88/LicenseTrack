import React, { useEffect, useState } from "react";
import CostForecastSection from "./CostForecastSection.jsx";
import PortfolioBreakdownSection from "./PortfolioBreakdownSection.jsx";
import PublisherBreakdownSection from "./PublisherBreakdownSection.jsx";
import RenewalCalendarSection from "./RenewalCalendarSection.jsx";
import PerpetualMaintenanceSection from "./PerpetualMaintenanceSection.jsx";
import PurchaseOrderSection from "./PurchaseOrderSection.jsx";

export default function ReportSections({
  filteredCount,
  costOverview,
  budgetForecast,
  forecastYears,
  forecastGrowthPct,
  onForecastYearsChange,
  onForecastGrowthPctChange,
  locale,
  singleCurrency,
  publisherData,
  vendorData,
  portfolioData,
  renewalData,
  purchaseOrderData,
  perpetualMaintenanceData,
  totalLicenseCount,
  hasActiveFilters,
  dateRangeError,
  onClearFilters,
  forceOpen,
}) {
  const defaultOpenSections = {
    costForecast: false,
    publisherVendor: false,
    portfolio: false,
    renewal: false,
    perpetualMaintenance: false,
    purchaseOrders: false,
  };
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem("licensetrack.reports.sections") || "null");
      return { ...defaultOpenSections, ...(saved || {}) };
    } catch {
      return defaultOpenSections;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem("licensetrack.reports.sections", JSON.stringify(openSections));
    } catch {
      // Section state is a convenience; storage availability should not affect reports.
    }
  }, [openSections]);

  const toggleSection = (sectionKey) => {
    setOpenSections((current) => ({ ...current, [sectionKey]: !current[sectionKey] }));
  };

  return (
    <>
      {filteredCount === 0 && totalLicenseCount > 0 && hasActiveFilters && !dateRangeError && (
        <div className="report-filter-empty">
          <div>
            <strong>No records match the current filters.</strong>
            <span>Try broadening the date range or department selection.</span>
          </div>
          <button type="button" className="btn btn-g btn-sm" onClick={onClearFilters}>Clear filters</button>
        </div>
      )}

      <CostForecastSection
        filteredCount={filteredCount}
        costOverview={costOverview}
        budgetForecast={budgetForecast}
        forecastYears={forecastYears}
        forecastGrowthPct={forecastGrowthPct}
        onForecastYearsChange={onForecastYearsChange}
        onForecastGrowthPctChange={onForecastGrowthPctChange}
        locale={locale}
        singleCurrency={singleCurrency}
        isOpen={openSections.costForecast}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

      <PublisherBreakdownSection
        publisherData={publisherData}
        vendorData={vendorData}
        locale={locale}
        singleCurrency={singleCurrency}
        isOpen={openSections.publisherVendor}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

      <PortfolioBreakdownSection
        portfolioData={portfolioData}
        totalCount={filteredCount}
        isOpen={openSections.portfolio}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

      <RenewalCalendarSection
        renewalData={renewalData}
        locale={locale}
        singleCurrency={singleCurrency}
        isOpen={openSections.renewal}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

      <PerpetualMaintenanceSection
        data={perpetualMaintenanceData}
        locale={locale}
        isOpen={openSections.perpetualMaintenance}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

      <PurchaseOrderSection
        data={purchaseOrderData}
        locale={locale}
        isOpen={openSections.purchaseOrders}
        onToggle={toggleSection}
        forceOpen={forceOpen}
      />

    </>
  );
}

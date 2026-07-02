import React from "react";
import CostForecastSection from "./CostForecastSection.jsx";
import PortfolioBreakdownSection from "./PortfolioBreakdownSection.jsx";
import PublisherBreakdownSection from "./PublisherBreakdownSection.jsx";
import RenewalCalendarSection from "./RenewalCalendarSection.jsx";

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
}) {
  return (
    <>
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
      />

      <PublisherBreakdownSection
        publisherData={publisherData}
        vendorData={vendorData}
        locale={locale}
        singleCurrency={singleCurrency}
      />

      <PortfolioBreakdownSection
        portfolioData={portfolioData}
        totalCount={filteredCount}
      />

      <RenewalCalendarSection
        renewalData={renewalData}
        locale={locale}
        singleCurrency={singleCurrency}
      />
    </>
  );
}

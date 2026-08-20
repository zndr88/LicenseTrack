import { LICENSE_TYPES, LICENSE_METRICS, MAINTENANCE_COVERAGE_OPTIONS } from "../../../constants/licenseData.js";
import MultiSelectFilter from "./MultiSelectFilter.jsx";

const INPUT_STYLE = {
  padding: "3px 7px",
  fontSize: 11,
  fontFamily: "var(--font-ui)",
  background: "var(--bg-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r)",
  color: "var(--text)",
  width: "100%",
  outline: "none",
};

export default function LicenseTableFilters({
  col,
  columnFilters,
  setColumnFilters,
  departments,
  datesFromOptions,
  datesToOptions,
}) {
  if (col.key === "licenseType") {
    return (
      <MultiSelectFilter
        id="cf-licenseType"
        options={LICENSE_TYPES}
        value={columnFilters.licenseType ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, licenseType: value }))}
        placeholder="Type"
      />
    );
  }

  if (col.key === "licenseMetric") {
    return (
      <MultiSelectFilter
        id="cf-licenseMetric"
        options={LICENSE_METRICS}
        value={columnFilters.licenseMetric ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, licenseMetric: value }))}
        placeholder="Metric"
      />
    );
  }

  if (col.key === "maintenanceCoverage") {
    return (
      <MultiSelectFilter
        id="cf-maintenanceCoverage"
        options={MAINTENANCE_COVERAGE_OPTIONS}
        value={columnFilters.maintenanceCoverage ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, maintenanceCoverage: value }))}
        placeholder="Coverage"
      />
    );
  }

  if (col.key === "costCentre") {
    return (
      <MultiSelectFilter
        id="cf-costCentre"
        options={departments.map((department) => ({ value: department, label: department }))}
        value={columnFilters.costCentre ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, costCentre: value }))}
        placeholder="Department"
      />
    );
  }

  if (col.key === "startDate") {
    return (
      <MultiSelectFilter
        id="cf-datesFrom"
        options={datesFromOptions}
        value={columnFilters.datesFrom ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, datesFrom: value }))}
        placeholder="Start Year"
      />
    );
  }

  if (col.key === "endDate") {
    return (
      <MultiSelectFilter
        id="cf-datesTo"
        options={datesToOptions}
        value={columnFilters.datesTo ?? []}
        onChange={(value) => setColumnFilters((filters) => ({ ...filters, datesTo: value }))}
        placeholder="End Year"
      />
    );
  }

  return (
    <input
      id={`cf-${col.key}`}
      type="text"
      placeholder="Filter..."
      value={columnFilters[col.key] ?? ""}
      onChange={(e) => setColumnFilters((filters) => ({ ...filters, [col.key]: e.target.value }))}
      style={INPUT_STYLE}
    />
  );
}

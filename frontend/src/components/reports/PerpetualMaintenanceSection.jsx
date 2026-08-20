import React from "react";
import { formatCost, formatCostByCurrency } from "../../utils/helpers.js";
import { EmptyState, Section } from "./reportShared.jsx";

const STATUS_LABELS = {
  included: "Included",
  included_missing: "Included · cost missing",
  separately_tracked: "Tracked separately",
  separate_missing: "Separate record missing",
  not_tracked: "Not tracked",
};

export default function PerpetualMaintenanceSection({ data, locale, isOpen, onToggle, forceOpen }) {
  const displayRows = data.rows.flatMap((row) => [
    { ...row, rowKind: "parent" },
    ...row.maintenanceRecords.map((record) => ({
      id: `${row.id}-maintenance-${record.id}`,
      rowKind: "maintenance",
      publisher: record.publisher,
      description: record.description,
      poNumber: record.poNumber,
      currency: record.currency,
      maintenanceValue: record.amount,
      maintenanceCurrency: record.currency,
      maintenanceSource: "maintenance_record",
      purchaseValue: 0,
    })),
  ]);

  return (
    <Section
      id="report-section-perpetual-maintenance"
      sectionKey="perpetualMaintenance"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      title="Perpetual Licenses & Maintenance"
      subtitle="Purchase value alongside support included on the license or tracked as a separate maintenance record"
      summary={`${data.rows.length} perpetual license${data.rows.length === 1 ? "" : "s"} · ${formatCostByCurrency(data.maintenanceByCurrency, locale)} maintenance`}
    >
      {data.rows.length === 0 ? <EmptyState /> : (
        <>
          <div className="report-metric-grid">
            <div>
              <div className="report-metric-label">Perpetual purchase value</div>
              <div className="report-metric-value">{formatCostByCurrency(data.purchaseByCurrency, locale)}</div>
              <div className="report-metric-note">Calculated from perpetual license lines</div>
            </div>
            <div>
              <div className="report-metric-label">Maintenance cost</div>
              <div className="report-metric-value report-metric-value-green">{formatCostByCurrency(data.maintenanceByCurrency, locale)}</div>
              <div className="report-metric-note">{data.includedCount} included · {data.separatelyTrackedCount} tracked separately</div>
            </div>
            <div>
              <div className="report-metric-label">Combined value</div>
              <div className="report-metric-value">{formatCostByCurrency(data.totalByCurrency, locale)}</div>
              <div className="report-metric-note">Only rows with matching currencies are combined</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th scope="col">License</th><th scope="col">Purchase order</th><th scope="col">Coverage</th><th scope="col" style={{ textAlign: "right" }}>Purchase</th><th scope="col" style={{ textAlign: "right" }}>Maintenance</th></tr></thead>
              <tbody>
                {displayRows.map((row) => (
                  <tr key={row.id}>
                    <td style={row.rowKind === "maintenance" ? { paddingLeft: 28 } : undefined}>
                      <div className="report-row-title">{row.rowKind === "maintenance" ? `Maintenance · ${row.publisher}` : row.publisher}</div>
                      <div className="report-row-sub">{row.description || "No description"}</div>
                    </td>
                    <td style={{ color: row.poNumber ? "var(--text-2)" : "var(--text-3)" }}>{row.poNumber || "No PO number"}</td>
                    <td style={{ color: row.maintenanceSource.includes("missing") ? "var(--orange)" : "var(--text-2)" }}>{row.rowKind === "maintenance" ? "Maintenance record" : STATUS_LABELS[row.maintenanceSource]}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{row.rowKind === "maintenance" ? "-" : formatCost(row.purchaseValue, row.currency, locale)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{formatCost(row.maintenanceValue, row.maintenanceCurrency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

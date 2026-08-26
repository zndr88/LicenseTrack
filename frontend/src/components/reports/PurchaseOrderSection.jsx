import React, { useMemo, useState } from "react";
import { formatCost, formatCostByCurrency } from "../../utils/helpers.js";
import { EmptyState, ReportTableToolbar, Section } from "./reportShared.jsx";

export default function PurchaseOrderSection({ data, locale, isOpen, onToggle, forceOpen }) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.rows;
    return data.rows.filter((row) => `${row.poNumber || "No PO number"} ${row.publisher} ${row.currency} ${row.status}`.toLowerCase().includes(query));
  }, [data.rows, search]);

  return (
    <Section
      id="report-section-purchase-orders"
      sectionKey="purchaseOrders"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      title="Purchase Order Value Tracker"
      subtitle="Reconcile each purchase order against the priced license lines in the filtered report"
      summary={`${data.poCount} purchase orders · ${formatCostByCurrency(data.totalsByCurrency, locale)}`}
    >
      {data.rows.length === 0 ? <EmptyState /> : (
        <>
          <div className="report-metric-grid">
            <div><div className="report-metric-label">Purchase order value</div><div className="report-metric-value">{formatCostByCurrency(data.totalsByCurrency, locale)}</div><div className="report-metric-note">Override value where supplied, otherwise priced lines</div></div>
            <div><div className="report-metric-label">License-line value</div><div className="report-metric-value">{formatCostByCurrency(data.lineTotalsByCurrency, locale)}</div><div className="report-metric-note">Value allocated to individual records</div></div>
            <div><div className="report-metric-label">Tracked orders</div><div className="report-metric-value">{data.poCount}</div><div className="report-metric-note">{data.overriddenCount} with a manual PO override · {data.unkeyedCount} unkeyed lines</div></div>
          </div>
          <ReportTableToolbar label="Search purchase order table" value={search} onChange={setSearch} placeholder="Search purchase orders..." resultCount={rows.length} totalCount={data.rows.length} />
          <div className="tbl-wrap">
            <table>
              <thead><tr><th scope="col">PO number</th><th scope="col">Publisher</th><th scope="col">Lines</th><th scope="col" style={{ textAlign: "right" }}>PO value</th><th scope="col" style={{ textAlign: "right" }}>Line value</th><th scope="col" style={{ textAlign: "right" }}>Difference</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.identityKey ?? `${row.poNumber || "unkeyed"}-${row.currency}`}>
                    <td><div className="report-row-title">{row.poNumber || "No PO number"}</div><div className="report-row-sub">{row.status === "override" ? "Manual PO value" : row.status === "reconciled" ? "Reconciled" : row.status === "unkeyed" ? "Counted individually" : "Line value differs"}</div></td>
                    <td style={{ color: row.publisher === "Multiple publishers" ? "var(--text-3)" : "var(--text-2)" }}>{row.publisher}</td>
                    <td style={{ color: "var(--text-2)" }}>{row.lineCount}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{formatCost(row.poValue, row.currency, locale)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{formatCost(row.lineValue, row.currency, locale)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: row.difference === 0 ? "var(--green-text)" : "var(--orange)" }}>{formatCost(row.difference, row.currency, locale)}</td>
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

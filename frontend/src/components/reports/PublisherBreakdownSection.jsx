import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCost, formatCostByCurrency } from "../../utils/helpers.js";
import { EmptyState, PALETTE, ReportTableToolbar, Section, SortHeader } from "./reportShared.jsx";

export default function PublisherBreakdownSection({ publisherData, vendorData, locale, singleCurrency, isOpen, onToggle, forceOpen }) {
  const [sortCol, setSortCol] = useState("totalSpend");
  const [sortDir, setSortDir] = useState("desc");
  const [vendorSearch, setVendorSearch] = useState("");

  const filteredVendors = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    if (!query) return vendorData;
    return vendorData.filter((row) => [row.publisher, row.supplier].some((value) => (
      String(value || "").toLowerCase().includes(query)
    )));
  }, [vendorData, vendorSearch]);

  const sortedVendors = useMemo(() => {
    return [...filteredVendors].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredVendors, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  return (
    <Section
      id="report-section-publisher-vendor"
      sectionKey="publisherVendor"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      summary={`${publisherData.length} publishers · ${vendorData.length} suppliers`}
      title="Publisher & Vendor Overview"
      subtitle="Top publishers and supplier relationships by calculated license value"
    >
      {publisherData.length === 0 ? <EmptyState /> : (
        <>
          {singleCurrency ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={publisherData.slice(0, 10)}
                layout="vertical"
                margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => formatCost(v, singleCurrency, locale)}
                  tick={{ fill: "var(--text-3)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="publisher"
                  width={160}
                  tick={{ fill: "var(--text-2)", fontSize: 11 }}
                  tickFormatter={(v) => v.length > 24 ? `${v.slice(0, 24)}...` : v}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        <div style={{ color: PALETTE[0] }}>Calculated Value: {formatCost(payload[0].value, singleCurrency, locale)}</div>
                      </div>
                    );
                  }}
                  cursor={{ fill: "var(--bg-hover)" }}
                />
                <Bar dataKey="totalSpend" name="Calculated Value" radius={[0, 4, 4, 0]}>
                  {publisherData.slice(0, 10).map((_, i) => (
                    <Cell key={i} fill={PALETTE[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="report-note" style={{ color: "var(--text-3)", fontStyle: "italic" }}>
              Spend chart unavailable — records use multiple currencies.
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <ReportTableToolbar
              label="Search publisher and supplier table"
              value={vendorSearch}
              onChange={setVendorSearch}
              placeholder="Search publishers or suppliers..."
              resultCount={filteredVendors.length}
              totalCount={vendorData.length}
            />
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Publisher" colKey="publisher" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Supplier" colKey="supplier" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Licenses" colKey="licenseCount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader label="Calculated Value" colKey="totalSpend" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedVendors.map((row, i) => (
                    <tr key={`${row.publisher}-${row.supplier}-${i}`} style={{ cursor: "default" }}>
                      <td style={{ fontWeight: 500 }}>{row.publisher}</td>
                      <td style={{ color: row.supplier ? "var(--text-2)" : "var(--text-3)" }}>
                        {row.supplier || "-"}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-2)" }}>{row.licenseCount}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>
                        {row.totalSpend === 0 && row.hasUnpricedLicenses ? (
                          <span style={{ color: "var(--text-3)" }} title="Some licenses in this group have no recorded price">- !</span>
                        ) : row.totalSpend > 0 ? (
                          <span>
                            {formatCostByCurrency(row.totalSpendByCurrency, locale)}
                            {row.hasUnpricedLicenses && (
                              <span style={{ marginLeft: 4, color: "var(--orange)" }} title="Some licenses in this group have no recorded price">!</span>
                            )}
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)" }}>
            Licenses without a recorded price are counted but excluded from spend totals.
          </div>
        </>
      )}
    </Section>
  );
}

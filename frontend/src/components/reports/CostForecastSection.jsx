import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCost, formatCostByCurrency } from "../../utils/helpers.js";
import Icon from "../ui/Icon.jsx";
import { EmptyState, PALETTE, ReportTableToolbar, Section } from "./reportShared.jsx";

function formatSpendByCurrency(byCurrency, locale) {
  const entries = Object.entries(byCurrency ?? {});
  if (entries.length === 0) return "—";
  return entries
    .map(([currency, amount]) => formatCost(amount, currency, locale))
    .join(" · ");
}

export default function CostForecastSection({
  filteredCount,
  costOverview,
  budgetForecast,
  forecastYears,
  forecastGrowthPct,
  onForecastYearsChange,
  onForecastGrowthPctChange,
  locale,
  singleCurrency,
  isOpen,
  onToggle,
  forceOpen,
}) {
  const [recordSearch, setRecordSearch] = useState("");
  const filteredRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    if (!query) return budgetForecast.recurringRecords;
    return budgetForecast.recurringRecords.filter((row) => [
      row.publisher,
      row.softwareDescription,
      row.supplier,
      row.licenseType,
      row.budgetOwnerEmail,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [budgetForecast.recurringRecords, recordSearch]);

  return (
    <Section
      id="report-section-cost-forecast"
      sectionKey="costForecast"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      summary={filteredCount > 0
        ? `${filteredCount} records · ${formatSpendByCurrency(costOverview.poSpendByCurrency, locale)} by PO value`
        : "No matching records"}
      title="Cost Overview & Forecast"
      subtitle="License-line spend, PO-value spend, and license-based future budget needs"
    >
      {filteredCount === 0 ? <EmptyState /> : (
        <>
          <div className="report-metric-grid">
            <div>
              <div className="report-metric-label">Spend by License</div>
              <div className="report-metric-value">
                {formatSpendByCurrency(costOverview.licenseSpendByCurrency, locale)}
              </div>
              <div className="report-metric-note">
                Calculated from each license line; used for breakdowns and forecasts
              </div>
            </div>
            <div>
              <div className="report-metric-label">Spend by PO Value</div>
              <div className="report-metric-value">
                {formatSpendByCurrency(costOverview.poSpendByCurrency, locale)}
              </div>
              <div className="report-metric-note">
                {costOverview.poCount > 0 ? `${costOverview.poCount} unique PO${costOverview.poCount === 1 ? "" : "s"}` : "No keyed POs"}
                {costOverview.unkeyedCount > 0 ? ` · ${costOverview.unkeyedCount} unkeyed license${costOverview.unkeyedCount === 1 ? "" : "s"} counted individually` : ""}
              </div>
            </div>
            <div>
              <div className="report-metric-label">Difference</div>
              <div className="report-metric-value">
                {formatSpendByCurrency(costOverview.spendDifferenceByCurrency, locale)}
              </div>
              <div className="report-metric-note">
                {Object.values(costOverview.spendDifferenceByCurrency).some((amount) => amount > 0)
                  ? "PO value not allocated to license lines"
                  : Object.values(costOverview.spendDifferenceByCurrency).some((amount) => amount < 0)
                    ? "License lines exceed their PO values"
                    : "PO and license totals reconcile"}
              </div>
            </div>
          </div>

          <div className="report-metric-grid" style={{ marginTop: 12 }}>
            <div>
              <div className="report-metric-label">
                {costOverview.isPeriodAllocated ? "Recurring In Range" : "Recurring Baseline"}
              </div>
              <div className="report-metric-value report-metric-value-green">
                {formatCostByCurrency(costOverview.recurringAnnualCostByCurrency, locale)}
              </div>
              <div className="report-metric-note">
                {costOverview.recurringCount} active recurring record{costOverview.recurringCount === 1 ? "" : "s"}
                {costOverview.isPeriodAllocated ? " allocated by overlapping days" : ""}
              </div>
            </div>
            <div>
              <div className="report-metric-label">Active Budget</div>
              <div className="report-metric-value report-metric-value-green">
                {formatCostByCurrency(costOverview.lifecycleBudgetByStatus.active, locale)}
              </div>
              <div className="report-metric-note">Active and perpetual calculated license value</div>
            </div>
            <div>
              <div className="report-metric-label">Expiring Budget</div>
              <div className="report-metric-value" style={{ color: "var(--orange)" }}>
                {formatCostByCurrency(costOverview.lifecycleBudgetByStatus.expiring, locale)}
              </div>
              <div className="report-metric-note">Calculated value expiring within the notification window</div>
            </div>
            <div>
              <div className="report-metric-label">Expired Budget</div>
              <div className="report-metric-value" style={{ color: "var(--red)" }}>
                {formatCostByCurrency(costOverview.lifecycleBudgetByStatus.expired, locale)}
              </div>
              <div className="report-metric-note">Expired calculated value requiring attention</div>
            </div>
          </div>

          {costOverview.unpricedCount > 0 && (
            <div className="report-inline-warning" style={{ marginTop: 12 }}>
              <Icon name="alert" size={11} color="var(--orange)" />
              {costOverview.unpricedCount} record{costOverview.unpricedCount === 1 ? "" : "s"} excluded because pricing is missing
            </div>
          )}

          {costOverview.overriddenPoCount > 0 && (
            <div className="report-inline-warning" style={{ marginTop: 12 }}>
              <Icon name="info" size={11} color="var(--orange)" />
              {costOverview.overriddenPoCount} PO override{costOverview.overriddenPoCount === 1 ? " is" : "s are"} included in PO-value spend but excluded from license breakdowns and forecasts
              {costOverview.isPeriodAllocated ? "; overrides are shown as full PO values" : ""}
            </div>
          )}

          <div className="report-controls">
            <div className="chip">
              <Icon name="clock" size={12} />
              <label htmlFor="forecast-years" className="report-chip-label">Years</label>
              <input
                id="forecast-years"
                type="number"
                min="1"
                max="10"
                value={forecastYears}
                onChange={(e) => onForecastYearsChange(Math.min(Math.max(Number(e.target.value) || 1, 1), 10))}
                className="report-chip-input report-chip-input-sm"
              />
            </div>
            <div className="chip">
              <Icon name="activity" size={12} />
              <label htmlFor="forecast-growth" className="report-chip-label">Annual uplift</label>
              <input
                id="forecast-growth"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={forecastGrowthPct}
                onChange={(e) => onForecastGrowthPctChange(Math.min(Math.max(Number(e.target.value) || 0, 0), 100))}
                className="report-chip-input"
              />
              <span className="report-chip-suffix">%</span>
            </div>
            {budgetForecast.fallbackCount > 0 && (
              <span className="report-inline-warning">
                <Icon name="alert" size={11} color="var(--orange)" />
                {budgetForecast.fallbackCount} recurring record{budgetForecast.fallbackCount === 1 ? "" : "s"} use legacy stored PO pricing
              </span>
            )}
          </div>

          {budgetForecast.forecastRows.length === 0 ? (
            singleCurrency === null && Object.keys(budgetForecast.baselineByCurrency).length > 0 ? (
              <div className="report-note" style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                Budget forecast chart unavailable — records use multiple currencies. Baseline: {formatCostByCurrency(budgetForecast.baselineByCurrency, locale)}
              </div>
            ) : <EmptyState />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={budgetForecast.forecastRows} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: "var(--text-2)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => formatCost(v, singleCurrency, locale)} tick={{ fill: "var(--text-3)", fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 12px", fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                          <div style={{ color: PALETTE[1] }}>Projected Budget: {formatCost(payload[0].value, singleCurrency, locale)}</div>
                        </div>
                      );
                    }}
                    cursor={{ fill: "var(--bg-hover)" }}
                  />
                  <Bar dataKey="projectedBudget" name="Projected Budget" fill={PALETTE[1]} radius={[4, 4, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>

              <ReportTableToolbar
                label="Search recurring records"
                value={recordSearch}
                onChange={setRecordSearch}
                placeholder="Search recurring records..."
                resultCount={filteredRecords.length}
                totalCount={budgetForecast.recurringRecords.length}
              />
              <div className="tbl-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Recurring Record</th>
                      <th scope="col">Type</th>
                      <th scope="col">Budget Owner</th>
                      <th scope="col" style={{ textAlign: "right" }}>Annual Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.slice(0, 10).map((row) => (
                      <tr key={row.id ?? `${row.publisher}-${row.softwareDescription}`} style={{ cursor: "default" }}>
                        <td>
                          <div className="report-row-title">{row.publisher}</div>
                          <div className="report-row-sub">{row.softwareDescription || row.supplier || "No description"}</div>
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{row.licenseType}</td>
                        <td style={{ color: row.budgetOwnerEmail ? "var(--text-2)" : "var(--text-3)" }}>
                          {row.budgetOwnerEmail || "Unassigned"}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>
                          {row.annualCost > 0 ? formatCost(row.annualCost, row.currency, locale) : "-"}
                          {row.costSource === "po_fallback" && (
                            <span style={{ marginLeft: 4, color: "var(--orange)" }} title="Line quantity or unit price is missing; using legacy stored PO pricing">!</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRecords.length > 10 && (
                <div className="report-note">
                  Showing top 10 matching recurring records by annual cost.
                </div>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

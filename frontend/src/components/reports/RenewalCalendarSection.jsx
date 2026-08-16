import React from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCost, formatCostByCurrency } from "../../utils/helpers.js";
import { EmptyState, PALETTE, Section } from "./reportShared.jsx";

export default function RenewalCalendarSection({ renewalData, locale, singleCurrency, isOpen, onToggle, forceOpen }) {
  return (
    <Section
      id="report-section-renewal"
      sectionKey="renewal"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      summary={`${renewalData.reduce((total, quarter) => total + quarter.count, 0)} licenses due`}
      title="Renewal Calendar"
      subtitle="Upcoming renewals by quarter (active and expiring licenses)"
    >
      {renewalData.every((q) => q.count === 0) ? <EmptyState /> : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={renewalData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="quarterLabel" tick={{ fill: "var(--text-2)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="count" orientation="left" tick={{ fill: "var(--text-3)", fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: "Licenses", angle: -90, position: "insideLeft", fill: "var(--text-3)", fontSize: 10, dy: 40 }} />
              {singleCurrency && (
                <YAxis yAxisId="value" orientation="right" tickFormatter={(v) => formatCost(v, singleCurrency, locale)} tick={{ fill: "var(--text-3)", fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 12px", fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                      {payload.map((p) => (
                        <div key={p.dataKey} style={{ color: p.color }}>
                          {p.name}: {p.dataKey === "estimatedValue" && singleCurrency
                            ? formatCost(p.value, singleCurrency, locale)
                            : p.value}
                        </div>
                      ))}
                    </div>
                  );
                }}
                cursor={{ fill: "var(--bg-hover)" }}
              />
              <Bar yAxisId="count" dataKey="count" name="Licenses Due" fill={PALETTE[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
              {singleCurrency && (
                <Bar yAxisId="value" dataKey="estimatedValue" name="Estimated Value" fill={PALETTE[1]} radius={[4, 4, 0, 0]} maxBarSize={48} />
              )}
            </BarChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 20 }}>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Quarter</th>
                    <th scope="col" style={{ textAlign: "right" }}>Licenses Due</th>
                    <th scope="col" style={{ textAlign: "right" }}>Estimated Value</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalData.map((row) => (
                    <tr key={row.quarterLabel} style={{ cursor: "default" }}>
                      <td style={{ fontWeight: 600 }}>{row.quarterLabel}</td>
                      <td style={{ textAlign: "right", color: "var(--text-2)" }}>{row.count}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>
                        {row.estimatedValue > 0 ? formatCostByCurrency(row.estimatedValueByCurrency, locale) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

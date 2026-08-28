import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DonutLegend, EmptyState, PALETTE, Section } from "./reportShared.jsx";

function DonutPanel({ title, data, total }) {
  return (
    <div style={{ flex: 1, minWidth: 0, width: "50%" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--text-2)" }}>{title}</div>
      {data.length === 0 ? <EmptyState /> : (
        <>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart height={320}>
              <Pie data={data} cx="50%" cy="50%" innerRadius={70} outerRadius={120} dataKey="value" stroke="none">
                {data.map((_, index) => (
                  <Cell key={index} fill={PALETTE[index % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 12px", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{payload[0].name}</span>: {payload[0].value}
                  </div>
                );
              }} />
            </PieChart>
          </ResponsiveContainer>
          <DonutLegend data={data} total={total} />
        </>
      )}
    </div>
  );
}

export default function PortfolioBreakdownSection({ portfolioData, totalCount, isOpen, onToggle, forceOpen }) {
  return (
    <Section
      id="report-section-portfolio"
      sectionKey="portfolio"
      isOpen={isOpen}
      onToggle={onToggle}
      forceOpen={forceOpen}
      summary={`${totalCount} records · ${portfolioData.byType.length} license types`}
      title="Portfolio Breakdown"
      subtitle="License composition by type and billing metric"
      sectionStyle={{ minHeight: 500 }}
    >
      {totalCount === 0 ? <EmptyState /> : (
        <div style={{ display: "flex", flexDirection: "row", width: "100%", gap: "24px" }}>
          <DonutPanel title="By License Type" data={portfolioData.byType} total={totalCount} />
          <DonutPanel title="By Billing Metric" data={portfolioData.byMetric} total={totalCount} />
        </div>
      )}
    </Section>
  );
}

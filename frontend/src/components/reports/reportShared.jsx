import React from "react";
import Icon from "../ui/Icon.jsx";

export const PALETTE = [
  "#3a7a9c",
  "#3d8b5e",
  "#c2601a",
  "#6b4faa",
  "#a83232",
  "#5aaac8",
  "#e07840",
  "#5cb87a",
];

const EMPTY_MSG = "No data available for the current filters";

export function Section({ id, title, subtitle, sectionStyle, children }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--rl)", marginBottom: 24 }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{subtitle}</div>
      </div>
      <div id={id} style={{ padding: "20px", width: "100%", boxSizing: "border-box", ...sectionStyle }}>
        {children}
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-3)", fontSize: 13 }}>
      {EMPTY_MSG}
    </div>
  );
}

export function DonutLegend({ data, total }) {
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      {data.map((item, i) => (
        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
          <span style={{ flex: 1, color: "var(--text-2)" }}>{item.name}</span>
          <span style={{ color: "var(--text)", fontWeight: 600, minWidth: 24, textAlign: "right" }}>{item.value}</span>
          <span style={{ color: "var(--text-3)", minWidth: 36, textAlign: "right" }}>
            {total > 0 ? `${Math.round((item.value / total) * 100)}%` : "0%"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SortHeader({ label, colKey, sortCol, sortDir, onSort, align = "left" }) {
  const active = sortCol === colKey;
  return (
    <th scope="col" onClick={() => onSort(colKey)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", textAlign: align }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: align === "right" ? "flex-end" : "flex-start", gap: 4, color: active ? "var(--accent)" : undefined }}>
        {label}
        {active ? (
          <Icon name={sortDir === "asc" ? "chevron-up" : "chevron-down"} size={11} color="var(--accent)" />
        ) : (
          <Icon name="chevron-down" size={11} color="var(--text-3)" />
        )}
      </span>
    </th>
  );
}

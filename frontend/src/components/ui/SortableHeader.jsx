import React from "react";

/**
 * Column header that sorts its table.
 *
 * Works with the mouse and the keyboard (Tab to the header, then Enter or
 * Space) and announces the current order to screen readers through aria-sort.
 * `sortDir` is "asc" or "desc" and only matters while `sortCol === column`.
 */
export default function SortableHeader({ column, label, sortCol, sortDir, onSort, className, style, title = "Click to sort" }) {
  const active = sortCol === column;
  return (
    <th
      scope="col"
      className={["sortable-th", className].filter(Boolean).join(" ")}
      style={style}
      tabIndex={0}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      title={title}
      onClick={() => onSort(column)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSort(column);
      }}
    >
      {label}
      {active && (
        <span className="sortable-th-indicator" aria-hidden="true">
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );
}

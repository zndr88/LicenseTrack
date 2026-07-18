import LicenseTableFilters from "./LicenseTableFilters.jsx";
import { NON_FILTERABLE_COLUMNS } from "./licenseTableShared.js";

function SortIndicator({ active, sortDir }) {
  if (!active) return null;
  return (
    <span style={{ marginLeft: 4, fontSize: 10, color: "var(--accent)", verticalAlign: "middle" }}>
      {sortDir === "asc" ? "▲" : "▼"}
    </span>
  );
}

export default function LicenseTableHeader({
  visibleColumns,
  selectAllRef,
  allFilteredSelected,
  filtered,
  setSelectedIds,
  dragHappenedRef,
  setUserSettings,
  setHoveredCol,
  hoveredCol,
  handleSortCol,
  sortCol,
  sortDir,
  handleHideColumn,
  filterRowOpen,
  columnFilters,
  setColumnFilters,
  departments,
  datesFromOptions,
  datesToOptions,
}) {
  return (
    <thead>
      <tr>
        {visibleColumns.map((col) => {
          if (col.key === "select") {
            return (
              <th
                key="select"
                scope="col"
                style={{
                  width: col.width,
                  minWidth: col.width,
                  padding: "0 8px",
                  verticalAlign: "middle",
                  textAlign: "center",
                }}
              >
                <input
                  type="checkbox"
                  ref={selectAllRef}
                  checked={allFilteredSelected}
                  onChange={() => {
                    if (allFilteredSelected) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(filtered.map((license) => license.id)));
                    }
                  }}
                  aria-label="Select all visible licenses"
                />
              </th>
            );
          }

          return (
            <th
              scope="col"
              key={col.key}
              draggable
              onDragStart={(e) => {
                dragHappenedRef.current = true;
                e.dataTransfer.setData("colKey", col.key);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dragKey = e.dataTransfer.getData("colKey");
                if (dragKey === col.key) return;
                const newOrder = visibleColumns.map((column) => column.key);
                const from = newOrder.indexOf(dragKey);
                const to = newOrder.indexOf(col.key);
                newOrder.splice(from, 1);
                newOrder.splice(to, 0, dragKey);
                setUserSettings((settings) => ({ ...settings, columnOrder: newOrder }));
              }}
              onMouseEnter={() => setHoveredCol(col.key)}
              onMouseLeave={() => setHoveredCol(null)}
              tabIndex={0}
              aria-sort={sortCol === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              onClick={() => {
                if (dragHappenedRef.current) {
                  dragHappenedRef.current = false;
                  return;
                }
                handleSortCol(col.key);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                handleSortCol(col.key);
              }}
              style={{
                width: col.width,
                minWidth: col.width,
                cursor: "pointer",
                userSelect: "none",
                position: "relative",
                whiteSpace: "nowrap",
              }}
              title="Click to sort / Drag to reorder"
            >
              {col.label}
              <SortIndicator active={sortCol === col.key} sortDir={sortDir} />
              {!col.always && hoveredCol === col.key && (
                <span
                  onClick={(e) => { e.stopPropagation(); handleHideColumn(col.key); }}
                  title="Hide column"
                  style={{
                    marginLeft: 4,
                    cursor: "pointer",
                    color: "var(--text-3)",
                    fontSize: 10,
                    verticalAlign: "middle",
                    lineHeight: 1,
                    display: "inline-block",
                  }}
                >
                  x
                </span>
              )}
            </th>
          );
        })}
      </tr>

      {filterRowOpen && (
        <tr>
          {visibleColumns.map((col) => {
            if (NON_FILTERABLE_COLUMNS.includes(col.key)) {
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={{ width: col.width, minWidth: col.width, padding: "4px 6px" }}
                />
              );
            }

            return (
              <th
                key={col.key}
                scope="col"
                style={{ width: col.width, minWidth: col.width, padding: "4px 6px" }}
              >
                <LicenseTableFilters
                  col={col}
                  columnFilters={columnFilters}
                  setColumnFilters={setColumnFilters}
                  departments={departments}
                  datesFromOptions={datesFromOptions}
                  datesToOptions={datesToOptions}
                />
              </th>
            );
          })}
        </tr>
      )}
    </thead>
  );
}

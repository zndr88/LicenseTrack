import LicenseTableFilters from "./LicenseTableFilters.jsx";
import { isColumnFilterable, isColumnSortable } from "./licenseTableShared.js";

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
  allDisplayedSelected,
  displayRows,
  selectionLabel,
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
                  checked={allDisplayedSelected}
                  onChange={() => {
                    setSelectedIds((previous) => {
                      const next = new Set(previous);
                      for (const license of displayRows) {
                        if (allDisplayedSelected) next.delete(license.id);
                        else next.add(license.id);
                      }
                      return next;
                    });
                  }}
                  aria-label={selectionLabel}
                />
              </th>
            );
          }

          return (
            (() => {
              const sortable = isColumnSortable(col);
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
              tabIndex={sortable ? 0 : undefined}
              aria-sort={sortCol === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              onClick={() => {
                if (!sortable) return;
                if (dragHappenedRef.current) {
                  dragHappenedRef.current = false;
                  return;
                }
                handleSortCol(col.key);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (sortable) handleSortCol(col.key);
              }}
              style={{
                width: col.width,
                minWidth: col.width,
                cursor: sortable ? "pointer" : "default",
                userSelect: "none",
                position: "relative",
                whiteSpace: "nowrap",
              }}
              title={sortable ? "Click to sort / Drag to reorder" : "Drag to reorder"}
            >
              {col.label}
              {sortable && <SortIndicator active={sortCol === col.key} sortDir={sortDir} />}
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
            })()
          );
        })}
      </tr>

      {filterRowOpen && (
        <tr>
          {visibleColumns.map((col) => {
            if (!isColumnFilterable(col)) {
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

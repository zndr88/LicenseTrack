import { useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Icon from "../../ui/Icon.jsx";
import LicenseTableFooter from "./LicenseTableFooter.jsx";
import LicenseTableHeader from "./LicenseTableHeader.jsx";
import LicenseTableRowCells from "./LicenseTableRowCells.jsx";
import { getVisibleColumns, rowStyle, VIRTUAL_THRESHOLD } from "./licenseTableShared.js";

export default function LicenseTable({
  filtered,
  paginatedItems,
  licenses,
  departments,
  datesFromOptions,
  datesToOptions,
  customFieldValuesMap,
  activeColumns,
  visList,
  displayCurrency,
  userSettings,
  setUserSettings,
  handleHideColumn,
  sortCol,
  sortDir,
  handleSortCol,
  selectedIds,
  setSelectedIds,
  allFilteredSelected,
  someFilteredSelected,
  filterRowOpen,
  columnFilters,
  setColumnFilters,
  hasColumnFilters,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  totalPages,
  hoveredCol,
  setHoveredCol,
  setSelectedId,
  inlineEditEnabled,
  onInlineFieldSave,
}) {
  const tblWrapRef = useRef(null);
  const selectAllRef = useRef(null);
  const dragHappenedRef = useRef(false);
  const [tblHeight, setTblHeight] = useState(500);

  const useVirtual = filtered.length > VIRTUAL_THRESHOLD;
  const visibleColumns = getVisibleColumns(activeColumns, visList);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => tblWrapRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  useEffect(() => {
    if (!useVirtual) return;
    const measure = () => {
      if (!tblWrapRef.current) return;
      const rect = tblWrapRef.current.getBoundingClientRect();
      const available = window.innerHeight - rect.top - 60;
      setTblHeight(Math.max(300, available));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [useVirtual]);

  useEffect(() => {
    if (useVirtual && tblWrapRef.current) {
      tblWrapRef.current.scrollTop = 0;
    }
  }, [filtered.length, useVirtual]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [someFilteredSelected, allFilteredSelected]);

  if (filtered.length === 0) {
    return (
      <div className="empty">
        <Icon name="file" size={32} color="var(--text-3)" />
        <h3>No licenses found</h3>
        <p>Adjust search/filters or add a license.</p>
      </div>
    );
  }

  const renderRow = (license) => (
    <tr
      key={license.id}
      tabIndex={0}
      onClick={() => {
        if (!inlineEditEnabled) setSelectedId(license.id);
      }}
      onKeyDown={(e) => {
        if (!inlineEditEnabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setSelectedId(license.id);
        }
      }}
      className={inlineEditEnabled ? "lp-row-inline-edit" : undefined}
      style={rowStyle(license)}
    >
      <LicenseTableRowCells
        license={license}
        visibleColumns={visibleColumns}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        licenses={licenses}
        customFieldValuesMap={customFieldValuesMap}
        displayCurrency={displayCurrency}
        userSettings={userSettings}
        inlineEditEnabled={inlineEditEnabled}
        onInlineFieldSave={onInlineFieldSave}
      />
    </tr>
  );

  return (
    <>
      <div
        className="lp-tbl-wrap"
        ref={tblWrapRef}
        style={useVirtual ? { height: tblHeight, overflowY: "auto" } : undefined}
      >
        <table className="license-table" style={{ tableLayout: "fixed" }}>
          <LicenseTableHeader
            visibleColumns={visibleColumns}
            selectAllRef={selectAllRef}
            allFilteredSelected={allFilteredSelected}
            filtered={filtered}
            setSelectedIds={setSelectedIds}
            dragHappenedRef={dragHappenedRef}
            setUserSettings={setUserSettings}
            setHoveredCol={setHoveredCol}
            hoveredCol={hoveredCol}
            handleSortCol={handleSortCol}
            sortCol={sortCol}
            sortDir={sortDir}
            handleHideColumn={handleHideColumn}
            filterRowOpen={filterRowOpen}
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            departments={departments}
            datesFromOptions={datesFromOptions}
            datesToOptions={datesToOptions}
          />
          <tbody>
            {useVirtual ? (() => {
              const virtualItems = rowVirtualizer.getVirtualItems();
              const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
              const paddingBottom = virtualItems.length > 0
                ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
                : 0;
              return (
                <>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumns.length} style={{ height: paddingTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {virtualItems.map((virtualRow) => renderRow(filtered[virtualRow.index]))}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumns.length} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </>
              );
            })() : (
              paginatedItems.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
      <LicenseTableFooter
        useVirtual={useVirtual}
        filtered={filtered}
        hasColumnFilters={hasColumnFilters}
        currentPage={currentPage}
        pageSize={pageSize}
        setPageSize={setPageSize}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
        userSettings={userSettings}
      />
    </>
  );
}

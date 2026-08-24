import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import { exportFilteredCsv } from "./exportFilteredCsv.js";
import { getFullExportColumns, LICENSE_COLUMN_GROUPS } from "./licenseColumns.js";
import { getVisibleColumns } from "./licenseTableShared.js";

const COLUMN_GROUP_LABELS = new Map([
  ...LICENSE_COLUMN_GROUPS.map((group) => [group.key, group.label]),
  ["custom", "Custom Fields"],
]);

function getSelectorKey(column) {
  return column.settingsKey ?? column.key;
}

function getSelectorLabel(column) {
  if (column.settingsKey === "dates") return column.settingsLabel ?? "Dates";
  return column.settingsLabel ?? column.label;
}

function buildColumnSelectorGroups(activeColumns) {
  const seen = new Set();
  const byGroup = new Map();
  for (const column of activeColumns) {
    if (!column.group || column.always || column.tableOnly) continue;
    const key = getSelectorKey(column);
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = {
      ...column,
      selectorKey: key,
      selectorLabel: getSelectorLabel(column),
    };
    const groupColumns = byGroup.get(column.group) ?? [];
    groupColumns.push(entry);
    byGroup.set(column.group, groupColumns);
  }

  return Array.from(COLUMN_GROUP_LABELS.entries())
    .map(([key, label]) => ({ key, label, columns: byGroup.get(key) ?? [] }))
    .filter((group) => group.columns.length > 0);
}

export default function LicenseToolbar({
  search, setSearch, setCurrentPage,
  filterRowOpen, setFilterRowOpen, hasColumnFilters, setColumnFilters,
  statsVisible, onSetStatsVisible,
  fullViewProp, handleToggleFullView,
  loadLicenses,
  selectedIds, setShowBulkDeleteConfirm,
  userSettings,
  handleSaveView, handleDeleteView, handleSetDefaultView, handleLoadView, handleRevertToDefault,
  handleSetVisibleColumn, handleSetVisibleColumnGroup,
  activeColumns, visList, filtered, displayCurrency, licenses, customFieldValuesMap,
  showError,
  inlineEditEnabled, onToggleInlineEdit, canInlineEdit,
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [pendingOverwriteName, setPendingOverwriteName] = useState(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [viewsPos, setViewsPos] = useState({});
  const [columnsPos, setColumnsPos] = useState({});
  const [exportPos, setExportPos] = useState({});

  const viewsBtnRef = useRef(null);
  const viewsMenuRef = useRef(null);
  const columnsBtnRef = useRef(null);
  const columnsMenuRef = useRef(null);
  const exportBtnRef = useRef(null);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (!viewsOpen) return;
    if (viewsBtnRef.current) {
      const r = viewsBtnRef.current.getBoundingClientRect();
      setViewsPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    const handler = (e) => {
      if (
        viewsBtnRef.current && !viewsBtnRef.current.contains(e.target) &&
        viewsMenuRef.current && !viewsMenuRef.current.contains(e.target)
      ) {
        setViewsOpen(false);
        setPendingOverwriteName(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewsOpen]);

  useEffect(() => {
    if (!columnsMenuOpen) return;
    const positionMenu = () => {
      if (!columnsBtnRef.current) return;
      const r = columnsBtnRef.current.getBoundingClientRect();
      const top = r.bottom + 4;
      setColumnsPos({
        top,
        right: window.innerWidth - r.right,
        maxHeight: Math.min(520, Math.max(0, window.innerHeight - top - 12)),
      });
    };
    positionMenu();
    const handler = (e) => {
      if (
        columnsBtnRef.current && !columnsBtnRef.current.contains(e.target) &&
        columnsMenuRef.current && !columnsMenuRef.current.contains(e.target)
      ) {
        setColumnsMenuOpen(false);
      }
    };
    window.addEventListener("resize", positionMenu);
    document.addEventListener("mousedown", handler);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("mousedown", handler);
    };
  }, [columnsMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    if (exportBtnRef.current) {
      const r = exportBtnRef.current.getBoundingClientRect();
      setExportPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    const handler = (e) => {
      if (
        exportBtnRef.current && !exportBtnRef.current.contains(e.target) &&
        exportMenuRef.current && !exportMenuRef.current.contains(e.target)
      ) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  const handleSaveViewLocal = (trimmed) => {
    if (!trimmed) return;
    const nameExists = userSettings.savedViews.some((v) => v.name === trimmed);
    if (nameExists) { setPendingOverwriteName(trimmed); return; }
    handleSaveView(trimmed); setNewViewName(""); setViewsOpen(false);
  };

  const handleExportCsv = ({ fullData = false, localized = false } = {}) => {
    try {
      const visibleCols = getVisibleColumns(activeColumns, visList)
        .filter((col) => col.key !== "select");
      const exportColumns = fullData
        ? getFullExportColumns(activeColumns)
        : visibleCols;
      exportFilteredCsv(
        filtered,
        exportColumns,
        userSettings.numberFormatLocale ?? "en-US",
        displayCurrency,
        licenses,
        customFieldValuesMap,
        { localized, userSettings, stableCustomFieldHeaders: fullData },
      );
      setExportMenuOpen(false);
    } catch (err) {
      showError("CSV export failed: " + (err?.message ?? "Unknown error"));
    }
  };

  const selectorGroups = buildColumnSelectorGroups(activeColumns);
  const isColumnVisible = (column) => Boolean(visList[column.selectorKey]);

  return (
    <div className="tbl-bar lp-toolbar-bar">
      <div className="lp-row1-left">
        <div className="lp-search-wrap">
          <input
            className={search ? "lp-search-input-has-value" : undefined}
            placeholder="Search..."
            aria-label="Search licenses"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setCurrentPage(1); }}
              aria-label="Clear search"
              className="lp-search-clear"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="lp-row1-right">
        {hasColumnFilters && (
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setColumnFilters({})}
            title="Clear column filters"
            aria-label="Clear column filters"
          >
            <Icon name="x" size={15} />
          </button>
        )}
        {/* Saved Views dropdown */}
        <button
          ref={viewsBtnRef}
          type="button"
          className={`toolbar-btn ${viewsOpen ? "toolbar-btn-active" : ""}`}
          onClick={() => { setViewsOpen((o) => !o); setPendingOverwriteName(null); }}
          title="Saved views"
          aria-label="Saved views"
          aria-pressed={viewsOpen}
        >
          <Icon name="bookmark" size={15} />
        </button>
        {viewsOpen && createPortal(
          <div ref={viewsMenuRef} className="lp-menu lp-view-menu" style={{ top: viewsPos.top, right: viewsPos.right }}>
            <button
              type="button"
              className="lp-menu-item lp-menu-item-muted"
              onClick={() => { handleRevertToDefault(); setViewsOpen(false); setPendingOverwriteName(null); }}
            >
              Default view
            </button>
            {userSettings.savedViews.length > 0 && (
              <hr className="lp-menu-separator" />
            )}
            {userSettings.savedViews.length === 0 && (
              <p className="lp-menu-empty">No saved views yet.</p>
            )}
            {userSettings.savedViews.map((v) => (
              <div key={v.name} className="lp-view-row">
                <button type="button" className="lp-view-load" onClick={() => { handleLoadView(v); setViewsOpen(false); setPendingOverwriteName(null); }}>
                  <span className="lp-view-name">{v.name}</span>
                  {v.isDefault && <span className="lp-view-default-badge">Default</span>}
                </button>
                <button
                  type="button"
                  className={`lp-view-default ${v.isDefault ? "lp-view-default-active" : ""}`}
                  onClick={() => handleSetDefaultView(v.name)}
                  title={v.isDefault ? "Unset as my default view" : "Set as my default view"}
                  aria-label={v.isDefault ? `Unset ${v.name} as my default view` : `Set ${v.name} as my default view`}
                  aria-pressed={Boolean(v.isDefault)}
                >
                  <Icon name={v.isDefault ? "star-filled" : "star"} size={12} />
                </button>
                <button
                  type="button"
                  className="lp-view-delete"
                  onClick={() => handleDeleteView(v.name)}
                  title="Delete view"
                  aria-label="Delete view"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            <hr className="lp-menu-separator lp-menu-separator-roomy" />
            {pendingOverwriteName ? (
              <div className="lp-overwrite-panel">
                <p className="lp-overwrite-text">
                  Overwrite <strong>{pendingOverwriteName}</strong>?
                </p>
                <div className="lp-overwrite-actions">
                  <button type="button" className="btn btn-g lp-compact-action" onClick={() => setPendingOverwriteName(null)}>Cancel</button>
                  <button type="button" className="btn btn-p lp-compact-action" onClick={() => { handleSaveView(pendingOverwriteName); setNewViewName(""); setPendingOverwriteName(null); setViewsOpen(false); }}>Overwrite</button>
                </div>
              </div>
            ) : (
              <div className="lp-save-view-row">
                <input className="fi lp-save-view-input" placeholder="View name..." value={newViewName} onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newViewName.trim()) {
                      handleSaveViewLocal(newViewName.trim());
                    }
                  }}
                />
                <button type="button" className="btn btn-p lp-save-view-button" disabled={!newViewName.trim()}
                  onClick={() => handleSaveViewLocal(newViewName.trim())}
                >Save</button>
              </div>
            )}
          </div>,
          document.body
        )}
        <button
          className={`toolbar-btn ${!statsVisible ? "toolbar-btn-active" : ""}`}
          onClick={() => onSetStatsVisible((v) => !v)}
          title="Toggle pipeline"
          aria-label="Toggle pipeline"
        >
          <Icon name="sliders" size={15} />
        </button>
        <button
          className={`toolbar-btn ${fullViewProp ? "toolbar-btn-active" : ""}`}
          onClick={handleToggleFullView}
          title={fullViewProp ? "Exit full view" : "Full view"}
          aria-label={fullViewProp ? "Exit full view" : "Full view"}
        >
          <Icon name="maximize" size={15} />
        </button>
        {canInlineEdit && (
          <button
            type="button"
            className={`toolbar-btn ${inlineEditEnabled ? "toolbar-btn-active" : ""}`}
            onClick={onToggleInlineEdit}
            title={inlineEditEnabled ? "Exit inline edit" : "Inline edit"}
            aria-label={inlineEditEnabled ? "Exit inline edit" : "Inline edit"}
            aria-pressed={inlineEditEnabled}
          >
            <Icon name={inlineEditEnabled ? "check" : "edit"} size={15} />
          </button>
        )}
        <button className="toolbar-btn" onClick={loadLicenses} title="Refresh" aria-label="Refresh">
          <Icon name="refresh" size={15} />
        </button>
        <button
          ref={columnsBtnRef}
          type="button"
          className={`toolbar-btn ${columnsMenuOpen ? "toolbar-btn-active" : ""}`}
          onClick={() => setColumnsMenuOpen((open) => !open)}
          title="Column categories"
          aria-label="Column categories"
          aria-expanded={columnsMenuOpen}
          aria-haspopup="menu"
        >
          <Icon name="columns" size={15} />
        </button>
        {columnsMenuOpen && createPortal(
          <div
            ref={columnsMenuRef}
            role="menu"
            aria-label="Column categories"
            className="lp-menu lp-column-menu"
            style={{ top: columnsPos.top, right: columnsPos.right, maxHeight: columnsPos.maxHeight }}
          >
            {selectorGroups.map((group) => {
              const allVisible = group.columns.every(isColumnVisible);
              return (
                <div key={group.key} className="lp-column-group">
                  <div className="lp-column-group-row">
                    <strong>{group.label}</strong>
                    <Toggle
                      ariaLabel={`Toggle all ${group.label} columns`}
                      value={allVisible}
                      onChange={(value) => handleSetVisibleColumnGroup(group.columns, value)}
                    />
                  </div>
                  {group.columns.map((column) => (
                    <div key={column.selectorKey} className="lp-column-option">
                      <span>{column.selectorLabel}</span>
                      <Toggle
                        ariaLabel={`Show ${column.selectorLabel} column`}
                        value={isColumnVisible(column)}
                        onChange={(value) => handleSetVisibleColumn(column.selectorKey, value)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>,
          document.body
        )}
        <button
          type="button"
          className={`toolbar-btn ${filterRowOpen || hasColumnFilters ? "toolbar-btn-active" : ""}`}
          onClick={() => setFilterRowOpen((o) => !o)}
          title={filterRowOpen ? "Hide column filters" : "Show column filters"}
          aria-label={filterRowOpen ? "Hide column filters" : "Show column filters"}
          aria-pressed={filterRowOpen}
        >
          <Icon name="filter" size={15} />
        </button>
        <button
          ref={exportBtnRef}
          type="button"
          className={`toolbar-btn ${exportMenuOpen ? "toolbar-btn-active" : ""}`}
          onClick={() => setExportMenuOpen((open) => !open)}
          title="Export CSV"
          aria-label="Export CSV"
          aria-expanded={exportMenuOpen}
          aria-haspopup="menu"
        >
          <Icon name="download" size={15} />
        </button>
        {exportMenuOpen && createPortal(
          <div
            ref={exportMenuRef}
            role="menu"
            aria-label="CSV export options"
            className="lp-menu lp-export-menu"
            style={{ top: exportPos.top, right: exportPos.right }}
          >
            <button
              type="button"
              role="menuitem"
              className="lp-export-option"
              onClick={() => handleExportCsv()}
            >
              <span className="lp-export-title">Export Current View</span>
              <span className="lp-export-subtitle">Filtered rows and visible columns</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="lp-export-option"
              onClick={() => handleExportCsv({ fullData: true })}
            >
              <span className="lp-export-title">Export Full Data</span>
              <span className="lp-export-subtitle">Filtered rows and every available column</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="lp-export-option"
              onClick={() => handleExportCsv({ localized: true })}
            >
              <span className="lp-export-title">Export Current View (localized)</span>
              <span className="lp-export-subtitle">Use your date and number formats</span>
            </button>
          </div>,
          document.body
        )}
        <div className="toolbar-add-gap" />
        {selectedIds.size > 0 && (
          <button
            type="button"
            className="btn btn-d btn-sm"
            onClick={() => setShowBulkDeleteConfirm(true)}
            aria-label={`Delete ${selectedIds.size} selected license(s)`}
          >
            <Icon name="trash" size={13} /> Delete ({selectedIds.size})
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "../../ui/Icon.jsx";
import { exportFilteredCsv } from "./exportFilteredCsv.js";
import { getFullExportColumns } from "./licenseColumns.js";
import { getVisibleColumns } from "./licenseTableShared.js";

export default function LicenseToolbar({
  search, setSearch, setCurrentPage,
  filterRowOpen, setFilterRowOpen, hasColumnFilters, setColumnFilters,
  statsVisible, onSetStatsVisible,
  fullViewProp, handleToggleFullView,
  loadLicenses,
  selectedIds, setShowBulkDeleteConfirm,
  userSettings,
  handleSaveView, handleDeleteView, handleLoadView, handleRevertToDefault,
  activeColumns, visList, filtered, displayCurrency, licenses, customFieldValuesMap,
  showError,
  inlineEditEnabled, onToggleInlineEdit, canInlineEdit,
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [pendingOverwriteName, setPendingOverwriteName] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [viewsPos, setViewsPos] = useState({});
  const [exportPos, setExportPos] = useState({});

  const viewsBtnRef = useRef(null);
  const viewsMenuRef = useRef(null);
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
        { localized, userSettings },
      );
      setExportMenuOpen(false);
    } catch (err) {
      showError("CSV export failed: " + (err?.message ?? "Unknown error"));
    }
  };

  return (
    <div className="tbl-bar lp-toolbar-bar">
      <div className="lp-row1-left">
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", width: "100%", maxWidth: 400 }}>
          <input
            placeholder="Search..."
            aria-label="Search licenses"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            style={{ paddingRight: search ? 28 : undefined }}
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setCurrentPage(1); }}
              aria-label="Clear search"
              style={{
                position: "absolute",
                right: 6,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--text-3)",
                fontSize: 14,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              ✕
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
          <div ref={viewsMenuRef} style={{ position: "fixed", top: viewsPos.top, right: viewsPos.right, zIndex: 9999, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, minWidth: 200, boxShadow: "var(--shadow-sm)" }}>
            <button
              type="button"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "4px 8px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", borderRadius: 4 }}
              onClick={() => { handleRevertToDefault(); setViewsOpen(false); setPendingOverwriteName(null); }}
            >
              Default view
            </button>
            {userSettings.savedViews.length > 0 && (
              <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            )}
            {userSettings.savedViews.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-3)", padding: "4px 8px" }}>No saved views yet.</p>
            )}
            {userSettings.savedViews.map((v) => (
              <div key={v.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", borderRadius: 4, gap: 8 }}>
                <button type="button" style={{ background: "none", border: "none", color: "var(--text-1)", cursor: "pointer", fontSize: 13, flex: 1, textAlign: "left" }} onClick={() => { handleLoadView(v); setViewsOpen(false); setPendingOverwriteName(null); }}>
                  {v.name}
                </button>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: "2px 4px", display: "inline-flex", alignItems: "center" }}
                  onClick={() => handleDeleteView(v.name)}
                  title="Delete view"
                  aria-label="Delete view"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "6px 0" }} />
            {pendingOverwriteName ? (
              <div style={{ padding: "6px 8px" }}>
                <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 6px" }}>
                  Overwrite <strong>{pendingOverwriteName}</strong>?
                </p>
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" className="btn btn-g" style={{ fontSize: 11, flex: 1 }} onClick={() => setPendingOverwriteName(null)}>Cancel</button>
                  <button type="button" className="btn btn-p" style={{ fontSize: 11, flex: 1 }} onClick={() => { handleSaveView(pendingOverwriteName); setNewViewName(""); setPendingOverwriteName(null); setViewsOpen(false); }}>Overwrite</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 4, padding: "2px 4px" }}>
                <input className="fi" style={{ fontSize: 12, padding: "4px 8px", flex: 1 }} placeholder="View name..." value={newViewName} onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newViewName.trim()) {
                      handleSaveViewLocal(newViewName.trim());
                    }
                  }}
                />
                <button type="button" className="btn btn-p" style={{ fontSize: 11, padding: "4px 8px" }} disabled={!newViewName.trim()}
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
            style={{ position: "fixed", top: exportPos.top, right: exportPos.right, zIndex: 9999, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 4, minWidth: 238, boxShadow: "var(--shadow-sm)" }}
          >
            <button
              type="button"
              role="menuitem"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 8px", color: "var(--text-1)", cursor: "pointer", borderRadius: 4 }}
              onClick={() => handleExportCsv()}
            >
              <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>Export Current View</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "var(--text-2)" }}>Filtered rows and visible columns</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 8px", color: "var(--text-1)", cursor: "pointer", borderRadius: 4 }}
              onClick={() => handleExportCsv({ fullData: true })}
            >
              <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>Export Full Data</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "var(--text-2)" }}>Filtered rows and every available column</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 8px", color: "var(--text-1)", cursor: "pointer", borderRadius: 4 }}
              onClick={() => handleExportCsv({ localized: true })}
            >
              <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>Export Current View (localized)</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "var(--text-2)" }}>Use your date and number formats</span>
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

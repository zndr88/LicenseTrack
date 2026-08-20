import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LICENSE_TYPES } from "../../constants/licenseData.js";
import Badge from "../ui/Badge.jsx";
import Icon from "../ui/Icon.jsx";
import Toggle from "../ui/Toggle.jsx";

const IMPORTER_COLUMNS = [
  ["publisher", "Publisher"],
  ["description", "Description"],
  ["type", "Type"],
  ["quantity", "Qty"],
  ["unitPrice", "Unit Price"],
  ["totalPoPrice", "Total Price"],
  ["startDate", "Start Date"],
  ["endDate", "End Date"],
  ["noticeDate", "Notice Date"],
  ["requestDate", "Request Date"],
  ["purchaseDate", "Purchase Date"],
  ["contractNumber", "Contract #"],
  ["poNumber", "PO #"],
  ["supplier", "Supplier"],
  ["costCentre", "Department"],
];

const DEFAULT_VISIBLE_IMPORTER_COLUMNS = new Set(IMPORTER_COLUMNS.map(([key]) => key));

function statusBadge(status) {
  if (status === "active") return <Badge type="green">Active</Badge>;
  if (status === "legacy_exempt") return <Badge type="gray">Legacy</Badge>;
  if (status === "legacy_incomplete") return <span className="badge" style={{ background: "var(--orange-m)", color: "var(--orange)" }}><span className="badge-dot" style={{ background: "var(--orange)" }} />Legacy (Incomplete)</span>;
  if (status === "error") return <Badge type="red">Error</Badge>;
  return <Badge type="gray">{status}</Badge>;
}

function needsMaintenanceParent(row) {
  if (row.licenseType !== "maintenance" || row.importStatus !== "error") return false;
  return (row.validationErrors || []).some((error) => (
    error.includes("parent_license_ref") || error.toLowerCase().includes("maintenance parent")
  ));
}

function maintenanceParentLabel(parent) {
  return [
    parent.licenseRef,
    `${parent.publisherName || "Unknown"} - ${parent.softwareDescription || "Untitled"}`,
    parent.poNumber ? `PO ${parent.poNumber}` : null,
  ].filter(Boolean).join(" | ");
}

function MaintenanceParentPicker({ rowNumber, selectedParentId, parents, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const [resultsPosition, setResultsPosition] = useState({});
  const normalizedQuery = query.trim().toLowerCase();
  const filteredParents = useMemo(() => parents.filter((parent) => (
    !normalizedQuery || maintenanceParentLabel(parent).toLowerCase().includes(normalizedQuery)
  )), [parents, normalizedQuery]);
  const selectedParent = parents.find((parent) => Number(parent.id) === Number(selectedParentId));

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target) && !resultsRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    const updateResultsPosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const maxHeight = Math.min(220, Math.max(120, window.innerHeight - rect.bottom - 12));
      setResultsPosition({
        position: "fixed",
        top: rect.bottom + 3,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };
    updateResultsPosition();
    window.addEventListener("resize", updateResultsPosition);
    window.addEventListener("scroll", updateResultsPosition, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateResultsPosition);
      window.removeEventListener("scroll", updateResultsPosition, true);
    };
  }, [open]);

  return (
    <div className="csv-parent-picker" ref={pickerRef}>
      <input
        id={`csv-parent-${rowNumber}`}
        ref={inputRef}
        className="fi csv-parent-search"
        aria-label="Maintenance parent required"
        placeholder="Select parent..."
        value={open ? query : (selectedParent ? maintenanceParentLabel(selectedParent) : "")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(event) => { setOpen(true); setQuery(event.target.value); }}
        role="combobox"
        aria-expanded={open}
        aria-controls={`csv-parent-results-${rowNumber}`}
      />
      {open && createPortal(
        <div ref={resultsRef} id={`csv-parent-results-${rowNumber}`} className="csv-parent-results" style={resultsPosition} role="listbox" aria-label={`Maintenance parent results for row ${rowNumber}`}>
          {filteredParents.length === 0 ? (
            <div className="csv-parent-empty">No matching eligible parent licenses.</div>
          ) : filteredParents.map((parent) => (
            <button
              key={parent.id}
              type="button"
              role="option"
              aria-selected={Number(parent.id) === Number(selectedParentId)}
              className={`csv-parent-option${Number(parent.id) === Number(selectedParentId) ? " selected" : ""}`}
              onClick={() => { onSelect(rowNumber, String(parent.id)); setQuery(""); setOpen(false); }}
            >
              {maintenanceParentLabel(parent)}
            </button>
          ))}
        </div>,
        document.body,
      )}
      {selectedParent && <div className="csv-action-resolved">Selected: {maintenanceParentLabel(selectedParent)}</div>}
    </div>
  );
}

export default function PreviewStep({
  previewData,
  skippedRows, selectedRows,
  duplicateWarningCount, importableRowsCount,
  allSelectableSelected, selectableRows,
  selectedImportableRows, selectedRowsToSkip, selectedRowsToRestore,
  toggleSelectedRow, toggleAllSelectableRows,
  skipRows, restoreRows,
  rowOverrides = {},
  setMaintenanceParentOverride = () => {},
  eligibleMaintenanceParents = [],
  showUpdateControls, updateExisting, onToggleUpdateExisting,
  handleConfirm, reset,
}) {
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_IMPORTER_COLUMNS);
  const columnsButtonRef = useRef(null);
  const columnsMenuRef = useRef(null);
  const [columnsMenuPosition, setColumnsMenuPosition] = useState({});

  useEffect(() => {
    if (!columnsMenuOpen) return undefined;
    const updateMenuPosition = () => {
      const button = columnsButtonRef.current;
      if (!button) return;
      const buttonRect = button.getBoundingClientRect();
      const menuRect = columnsMenuRef.current?.getBoundingClientRect();
      const menuWidth = menuRect?.width ?? Math.min(280, window.innerWidth - 24);
      const menuHeight = menuRect?.height ?? 0;
      const top = Math.max(
        8,
        Math.min(buttonRect.bottom + 4, window.innerHeight - menuHeight - 8),
      );
      const right = Math.max(
        8,
        Math.min(window.innerWidth - buttonRect.right, window.innerWidth - menuWidth - 8),
      );
      setColumnsMenuPosition({ top, right });
    };

    updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);
    const handleOutsideClick = (event) => {
      if (
        columnsButtonRef.current && !columnsButtonRef.current.contains(event.target)
        && columnsMenuRef.current && !columnsMenuRef.current.contains(event.target)
      ) {
        setColumnsMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setColumnsMenuOpen(false);
      columnsButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    const firstToggle = columnsMenuRef.current?.querySelector('[role="switch"]');
    firstToggle?.focus();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [columnsMenuOpen]);

  if (!previewData) return null;

  const allImporterColumnsVisible = IMPORTER_COLUMNS.every(([key]) => visibleColumns.has(key));
  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAllImporterColumns = (value) => {
    setVisibleColumns(value ? new Set(DEFAULT_VISIBLE_IMPORTER_COLUMNS) : new Set());
  };
  const showColumn = (key) => visibleColumns.has(key);

  const actionRequiredCount = previewData.rows.filter((row) => (
    needsMaintenanceParent(row) && !rowOverrides[row.rowNumber]?.parentLicenseId
  )).length;
  const unresolvedErrorCount = previewData.rows.filter((row) => (
    row.importStatus === "error"
    && !needsMaintenanceParent(row)
    && !rowOverrides[row.rowNumber]?.parentLicenseId
  )).length;

  const empty = <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>—</span>;

  return (
    <div>
      {/* Summary chips */}
      <div className="csv-chips">
        <div className="csv-chip">
          <span className="csv-chip-label">Rows found</span>
          <span className="csv-chip-val" style={{ color: "var(--text)" }}>{previewData.totalRows}</span>
        </div>
        <div className="csv-chip csv-chip-green">
          <span className="csv-chip-label">Active</span>
          <span className="csv-chip-val" style={{ color: "var(--green)" }}>{previewData.activeCount}</span>
        </div>
        {(previewData.legacyExemptCount + previewData.legacyIncompleteCount) > 0 && (
          <div className="csv-chip csv-chip-gray">
            <span className="csv-chip-label">Legacy</span>
            <span className="csv-chip-val" style={{ color: "var(--text-2)" }}>{previewData.legacyExemptCount + previewData.legacyIncompleteCount}</span>
          </div>
        )}
        {unresolvedErrorCount > 0 && (
          <div className="csv-chip csv-chip-red">
            <span className="csv-chip-label">Errors</span>
            <span className="csv-chip-val" style={{ color: "var(--red)" }}>{unresolvedErrorCount}</span>
          </div>
        )}
        {actionRequiredCount > 0 && (
          <div className="csv-chip">
            <span className="csv-chip-label">Action required</span>
            <span className="csv-chip-val" style={{ color: "var(--orange)" }}>{actionRequiredCount}</span>
          </div>
        )}
        {duplicateWarningCount > 0 && (
          <div className="csv-chip">
            <span className="csv-chip-label">Possible duplicates</span>
            <span className="csv-chip-val" style={{ color: "var(--orange)" }}>{duplicateWarningCount}</span>
          </div>
        )}
        {skippedRows.size > 0 && (
          <div className="csv-chip">
            <span className="csv-chip-label">Skipped</span>
            <span className="csv-chip-val" style={{ color: "var(--text-2)" }}>{skippedRows.size}</span>
          </div>
        )}
      </div>

      {showUpdateControls && (
        <div className="csv-missing-warn" style={{ alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => onToggleUpdateExisting(e.target.checked)}
            />
            <span>
              <strong>Update existing records when LT Ref matches.</strong>{" "}
              {updateExisting
                ? `${previewData.updateCount ?? 0} will update, ${previewData.createCount ?? 0} will be created.`
                : "Off — every row will be created as a new license."}
            </span>
          </label>
        </div>
      )}

      {previewData.headersMissing.length > 0 && (
        <div className="csv-missing-warn">
          <Icon name="alert" size={14} color="var(--orange-text)" />
          <span>Recommended columns not found: <strong>{previewData.headersMissing.join(", ")}</strong>. These fields will be blank for all imported rows.</span>
        </div>
      )}
      {duplicateWarningCount > 0 && (
        <div className="csv-missing-warn">
          <Icon name="alert" size={14} color="var(--orange-text)" />
          <span><strong>{duplicateWarningCount} possible duplicate {duplicateWarningCount === 1 ? "warning" : "warnings"} found.</strong> These are warnings only; matching rows can still be imported.</span>
        </div>
      )}

      {previewData.warningSummary?.hasWarnings && (
        <div className="csv-warn-box" data-testid="csv-warning-summary">
          <Icon name="alert" size={14} color="var(--orange-text)" />
          <div>
            <strong>Some rows have defaults or warnings that will be accepted on import:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 18, fontSize: 12 }}>
              {previewData.warningSummary.inferredParentCount > 0 && (
                <li>Inferred maintenance parent: <strong>{previewData.warningSummary.inferredParentCount}</strong> row{previewData.warningSummary.inferredParentCount !== 1 ? "s" : ""}</li>
              )}
              {previewData.warningSummary.duplicateWarningCount > 0 && (
                <li>Possible duplicates: <strong>{previewData.warningSummary.duplicateWarningCount}</strong> row{previewData.warningSummary.duplicateWarningCount !== 1 ? "s" : ""}</li>
              )}
              {previewData.warningSummary.defaultedCurrencyCount > 0 && (
                <li>Currency defaulted: <strong>{previewData.warningSummary.defaultedCurrencyCount}</strong> row{previewData.warningSummary.defaultedCurrencyCount !== 1 ? "s" : ""}</li>
              )}
              {previewData.warningSummary.priceMismatchCount > 0 && (
                <li>Price total mismatch: <strong>{previewData.warningSummary.priceMismatchCount}</strong> row{previewData.warningSummary.priceMismatchCount !== 1 ? "s" : ""}</li>
              )}
              {previewData.warningSummary.expiredMaintenanceCount > 0 && (
                <li>Maintenance expired: <strong>{previewData.warningSummary.expiredMaintenanceCount}</strong> row{previewData.warningSummary.expiredMaintenanceCount !== 1 ? "s" : ""}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Preview table */}
      <div className="tbl-wrap">
        <div className="csv-bulkbar">
          <div className="csv-bulkbar-count">
            {selectedImportableRows.length > 0
              ? `${selectedImportableRows.length} selected`
              : `${importableRowsCount} will import`}
          </div>
          <div className="csv-bulkbar-actions">
            <button
              ref={columnsButtonRef}
              type="button"
              className={`toolbar-btn csv-columns-button ${columnsMenuOpen ? "toolbar-btn-active" : ""}`}
              onClick={() => setColumnsMenuOpen((open) => !open)}
              title="Choose importer columns"
              aria-label="Choose importer columns"
              aria-expanded={columnsMenuOpen}
              aria-haspopup="dialog"
              aria-controls="csv-importer-columns-menu"
            >
              <Icon name="columns" size={15} />
            </button>
            {columnsMenuOpen && createPortal(
              <div
                ref={columnsMenuRef}
                id="csv-importer-columns-menu"
                role="dialog"
                aria-label="Importer columns"
                className="lp-menu lp-column-menu csv-columns-menu"
                style={{ top: columnsMenuPosition.top, right: columnsMenuPosition.right }}
              >
                <div className="lp-column-group">
                  <div className="lp-column-group-row">
                    <strong>Importer columns</strong>
                    <Toggle
                      ariaLabel="Toggle all importer columns"
                      value={allImporterColumnsVisible}
                      onChange={toggleAllImporterColumns}
                    />
                  </div>
                  {IMPORTER_COLUMNS.map(([key, label]) => (
                    <div key={key} className="lp-column-option">
                      <span>{label}</span>
                      <Toggle
                        ariaLabel={`Show ${label} column`}
                        value={showColumn(key)}
                        onChange={() => toggleColumn(key)}
                      />
                    </div>
                  ))}
                </div>
              </div>,
              document.body,
            )}
            <button type="button" className="btn btn-g" style={{ fontSize: 12 }} disabled={selectedRowsToSkip.length === 0} onClick={() => skipRows(selectedRowsToSkip)}>
              Skip selected
            </button>
            {selectedRowsToRestore.length > 0 && (
              <button type="button" className="btn btn-g" style={{ fontSize: 12 }} onClick={() => restoreRows(selectedRowsToRestore)}>
                Restore selected
              </button>
            )}
          </div>
        </div>
        <div className="lp-tbl-wrap">
          <table className={`csv-preview-table${visibleColumns.size < IMPORTER_COLUMNS.length ? " csv-preview-table-condensed" : ""}`}>
            <thead><tr>
              <th scope="col" className="csv-select-col">
                <input type="checkbox" aria-label="Select all importable rows" checked={allSelectableSelected} disabled={selectableRows.length === 0} onChange={toggleAllSelectableRows} />
              </th>
              <th scope="col" style={{ width: 40 }}>Row</th>
              {showColumn("publisher") && <th scope="col">Publisher</th>}
              {showColumn("description") && <th scope="col">Description</th>}
              {showColumn("type") && <th scope="col">Type</th>}
              {showColumn("quantity") && <th scope="col">Qty</th>}
              {showColumn("unitPrice") && <th scope="col">Unit Price</th>}
              {showColumn("totalPoPrice") && <th scope="col">Total Price</th>}
              {showColumn("startDate") && <th scope="col">Start Date</th>}
              {showColumn("endDate") && <th scope="col">End Date</th>}
              {showColumn("noticeDate") && <th scope="col">Notice Date</th>}
              {showColumn("requestDate") && <th scope="col">Request Date</th>}
              {showColumn("purchaseDate") && <th scope="col">Purchase Date</th>}
              {showColumn("contractNumber") && <th scope="col">Contract #</th>}
              {showColumn("poNumber") && <th scope="col">PO #</th>}
              {showColumn("supplier") && <th scope="col">Supplier</th>}
              {showColumn("costCentre") && <th scope="col">Department</th>}
              <th scope="col">Status</th>
              <th scope="col" className="csv-issues-col">Issues</th>
              <th scope="col">Import</th>
            </tr></thead>
            <tbody>
              {previewData.rows.map((row) => {
                const isSkipped = skippedRows.has(row.rowNumber);
                const needsParent = needsMaintenanceParent(row);
                const selectedParentId = rowOverrides[row.rowNumber]?.parentLicenseId || "";
                const parentResolved = needsParent && !!selectedParentId;
                const canSelect = row.importStatus !== "error" || parentResolved;
                const validationErrors = parentResolved
                  ? (row.validationErrors || []).filter((error) => (
                    !error.includes("parent_license_ref") && !error.toLowerCase().includes("maintenance parent")
                  ))
                  : needsParent
                    ? (row.validationErrors || []).filter((error) => (
                      !error.includes("parent_license_ref") && !error.toLowerCase().includes("maintenance parent")
                    ))
                  : row.validationErrors;
                return (
                  <tr
                    key={row.rowNumber}
                    className={isSkipped ? "csv-row-skipped" : undefined}
                    style={row.importStatus === "error" && !parentResolved
                      ? { background: needsParent ? "var(--orange-dim)" : "var(--red-dim)", opacity: needsParent ? 1 : 0.45 }
                      : undefined}
                  >
                    <td className="csv-select-col">
                      <input type="checkbox" aria-label={`Select row ${row.rowNumber}`} checked={selectedRows.has(row.rowNumber)} disabled={!canSelect} onChange={() => toggleSelectedRow(row.rowNumber)} />
                    </td>
                    <td className="mono csv-row-num">{row.rowNumber}</td>
                    {showColumn("publisher") && <td style={{ fontWeight: row.publisherName ? 500 : 400 }}>{row.publisherName || empty}</td>}
                    {showColumn("description") && <td className="csv-desc">{row.softwareDescription || empty}</td>}
                    {showColumn("type") && <td>{LICENSE_TYPES.find((t) => t.value === row.licenseType)?.label || row.licenseType || empty}</td>}
                    {showColumn("quantity") && <td className="mono csv-mono-sm">{row.quantity || empty}</td>}
                    {showColumn("unitPrice") && <td className="mono csv-mono-sm">{row.unitPrice || empty}</td>}
                    {showColumn("totalPoPrice") && <td className="mono csv-mono-sm">{row.totalPoPrice || empty}</td>}
                    {showColumn("startDate") && <td className="mono csv-mono-sm">{row.startDate || empty}</td>}
                    {showColumn("endDate") && <td className="mono csv-mono-sm">{row.endDate || (row.importStatus !== "error" ? <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Perpetual</span> : empty)}</td>}
                    {showColumn("noticeDate") && <td className="mono csv-mono-sm">{row.noticeDate || empty}</td>}
                    {showColumn("requestDate") && <td className="mono csv-mono-sm">{row.requestDate || empty}</td>}
                    {showColumn("purchaseDate") && <td className="mono csv-mono-sm">{row.purchaseDate || empty}</td>}
                    {showColumn("contractNumber") && <td className="mono csv-mono-sm">{row.contractNumber || empty}</td>}
                    {showColumn("poNumber") && <td className="mono csv-mono-sm">{row.poNumber || empty}</td>}
                    {showColumn("supplier") && <td>{row.supplier || empty}</td>}
                    {showColumn("costCentre") && <td>{row.costCentre || empty}</td>}
                    <td className="csv-issues-col">
                      {isSkipped ? <Badge type="gray">Skipped</Badge> : (
                        <>
                          {parentResolved ? <Badge type="green">Resolved</Badge> : needsParent ? <Badge type="orange">Action required</Badge> : statusBadge(row.importStatus)}
                          {row.importAction === "update" && row.importStatus !== "error" && (
                            <Badge type="blue">Update</Badge>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {(validationErrors.length > 0 || row.warnings.length > 0 || (row.duplicateWarnings?.length || 0) > 0 || needsParent) ? (
                        <div>
                          {validationErrors.map((e, i) => <div key={`e${i}`} className="csv-err-item">{e}</div>)}
                          {(row.duplicateWarnings || []).map((w, i) => <div key={`d${i}`} className="csv-warn-item">{w.message}</div>)}
                          {row.warnings.map((w, i) => <div key={`w${i}`} className="csv-warn-item">{w}</div>)}
                          {needsParent && (
                            <div className="csv-parent-action">
                              <label className="csv-parent-action-label" htmlFor={`csv-parent-${row.rowNumber}`}>
                                Maintenance parent required
                              </label>
                              <MaintenanceParentPicker
                                rowNumber={row.rowNumber}
                                selectedParentId={selectedParentId}
                                parents={eligibleMaintenanceParents}
                                onSelect={setMaintenanceParentOverride}
                              />
                              {!parentResolved && (
                                <div className="csv-parent-action-help">Choose an existing perpetual, OEM, or freeware parent.</div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : <Icon name="check" size={13} color="var(--green)" />}
                    </td>
                    <td>
                      {canSelect ? (
                        <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => isSkipped ? restoreRows([row.rowNumber]) : skipRows([row.rowNumber])}>
                          {isSkipped ? "Restore" : "Skip"}
                        </button>
                      ) : empty}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {unresolvedErrorCount > 0 && (
        <div className="csv-error-notice">
          <Icon name="alert" size={13} color="var(--red-text)" />
          <span><strong style={{ color: "var(--red-text)" }}>{unresolvedErrorCount} {unresolvedErrorCount === 1 ? "row" : "rows"}</strong> will be skipped due to errors. Only valid rows will be imported.</span>
        </div>
      )}

      {duplicateWarningCount === 0 && (
        <div className="csv-warn-box">
          <Icon name="alert" size={14} color="var(--orange-text)" />
          <span><strong>Duplicate check:</strong> No likely duplicates were found in this preview. Importing the same file again later can still create duplicate records.</span>
        </div>
      )}

      <div className="csv-actions">
        <button className="btn btn-g" onClick={reset}>Cancel</button>
        <button className="btn btn-p" onClick={handleConfirm} disabled={importableRowsCount === 0}>
          <Icon name="upload" size={13} />
          {previewData.warningSummary?.hasWarnings
            ? `Acknowledge warnings and import (${importableRowsCount} ${importableRowsCount === 1 ? "license" : "licenses"})`
            : `Import ${importableRowsCount} ${importableRowsCount === 1 ? "license" : "licenses"}`}
        </button>
      </div>
    </div>
  );
}

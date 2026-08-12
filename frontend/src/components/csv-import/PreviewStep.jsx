import { LICENSE_TYPES } from "../../constants/licenseData.js";
import Badge from "../ui/Badge.jsx";
import Icon from "../ui/Icon.jsx";

function statusBadge(status) {
  if (status === "active") return <Badge type="green">Active</Badge>;
  if (status === "legacy_exempt") return <Badge type="gray">Legacy</Badge>;
  if (status === "legacy_incomplete") return <span className="badge" style={{ background: "var(--orange-m)", color: "var(--orange)" }}><span className="badge-dot" style={{ background: "var(--orange)" }} />Legacy (Incomplete)</span>;
  if (status === "error") return <Badge type="red">Error</Badge>;
  return <Badge type="gray">{status}</Badge>;
}

export default function PreviewStep({
  previewData,
  skippedRows, selectedRows,
  duplicateWarningCount, importableRowsCount,
  allSelectableSelected, selectableRows,
  selectedImportableRows, selectedRowsToSkip, selectedRowsToRestore,
  toggleSelectedRow, toggleAllSelectableRows,
  skipRows, restoreRows,
  showUpdateControls, updateExisting, onToggleUpdateExisting,
  handleConfirm, reset,
}) {
  if (!previewData) return null;

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
        {previewData.errorCount > 0 && (
          <div className="csv-chip csv-chip-red">
            <span className="csv-chip-label">Errors</span>
            <span className="csv-chip-val" style={{ color: "var(--red)" }}>{previewData.errorCount}</span>
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
          <table className="csv-preview-table">
            <thead><tr>
              <th scope="col" className="csv-select-col">
                <input type="checkbox" aria-label="Select all importable rows" checked={allSelectableSelected} disabled={selectableRows.length === 0} onChange={toggleAllSelectableRows} />
              </th>
              <th scope="col" style={{ width: 40 }}>Row</th>
              <th scope="col">Publisher</th>
              <th scope="col">Description</th>
              <th scope="col">Type</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit Price</th>
              <th scope="col">Total Price</th>
              <th scope="col">Start Date</th>
              <th scope="col">End Date</th>
              <th scope="col">Notice Date</th>
              <th scope="col">Contract #</th>
              <th scope="col">PO #</th>
              <th scope="col">Supplier</th>
              <th scope="col">Department</th>
              <th scope="col">Status</th>
              <th scope="col">Issues</th>
              <th scope="col">Import</th>
            </tr></thead>
            <tbody>
              {previewData.rows.map((row) => {
                const isSkipped = skippedRows.has(row.rowNumber);
                const canSelect = row.importStatus !== "error";
                return (
                  <tr
                    key={row.rowNumber}
                    className={isSkipped ? "csv-row-skipped" : undefined}
                    style={row.importStatus === "error" ? { opacity: 0.45, background: "var(--red-dim)" } : undefined}
                  >
                    <td className="csv-select-col">
                      <input type="checkbox" aria-label={`Select row ${row.rowNumber}`} checked={selectedRows.has(row.rowNumber)} disabled={!canSelect} onChange={() => toggleSelectedRow(row.rowNumber)} />
                    </td>
                    <td className="mono csv-row-num">{row.rowNumber}</td>
                    <td style={{ fontWeight: row.publisherName ? 500 : 400 }}>{row.publisherName || empty}</td>
                    <td className="csv-desc">{row.softwareDescription || empty}</td>
                    <td>{LICENSE_TYPES.find((t) => t.value === row.licenseType)?.label || row.licenseType || empty}</td>
                    <td className="mono csv-mono-sm">{row.quantity || empty}</td>
                    <td className="mono csv-mono-sm">{row.unitPrice || empty}</td>
                    <td className="mono csv-mono-sm">{row.totalPoPrice || empty}</td>
                    <td className="mono csv-mono-sm">{row.startDate || empty}</td>
                    <td className="mono csv-mono-sm">{row.endDate || (row.importStatus !== "error" ? <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Perpetual</span> : empty)}</td>
                    <td className="mono csv-mono-sm">{row.noticeDate || empty}</td>
                    <td className="mono csv-mono-sm">{row.contractNumber || empty}</td>
                    <td className="mono csv-mono-sm">{row.poNumber || empty}</td>
                    <td>{row.supplier || empty}</td>
                    <td>{row.costCentre || empty}</td>
                    <td>
                      {isSkipped ? <Badge type="gray">Skipped</Badge> : (
                        <>
                          {statusBadge(row.importStatus)}
                          {row.importAction === "update" && row.importStatus !== "error" && (
                            <Badge type="blue">Update</Badge>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {(row.validationErrors.length > 0 || row.warnings.length > 0 || (row.duplicateWarnings?.length || 0) > 0) ? (
                        <div>
                          {row.validationErrors.map((e, i) => <div key={`e${i}`} className="csv-err-item">{e}</div>)}
                          {(row.duplicateWarnings || []).map((w, i) => <div key={`d${i}`} className="csv-warn-item">{w.message}</div>)}
                          {row.warnings.map((w, i) => <div key={`w${i}`} className="csv-warn-item">{w}</div>)}
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

      {previewData.errorCount > 0 && (
        <div className="csv-error-notice">
          <Icon name="alert" size={13} color="var(--red-text)" />
          <span><strong style={{ color: "var(--red-text)" }}>{previewData.errorCount} {previewData.errorCount === 1 ? "row" : "rows"}</strong> will be skipped due to errors. Only valid rows will be imported.</span>
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
            ? `Import with warnings (${importableRowsCount} ${importableRowsCount === 1 ? "license" : "licenses"})`
            : `Import ${importableRowsCount} ${importableRowsCount === 1 ? "license" : "licenses"}`}
        </button>
      </div>
    </div>
  );
}

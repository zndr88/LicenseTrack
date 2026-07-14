import Icon from "../ui/Icon.jsx";
import { NATIVE_FIELDS } from "../../constants/csvImport.js";

const CUSTOM_FIELD_TYPE_LABELS = { text: "Text", currency: "Currency", date: "Date", boolean: "True/False" };

// LicenseTrack exports include license_ref - use it as the detection signal.
function looksLikeLTExport(analyzeData) {
  return (analyzeData?.matchedColumns ?? []).some((c) => c.internalField === "license_ref");
}

export default function MappingStep({
  analyzeData,
  error,
  showMatched, setShowMatched,
  activeMatchedColumns, allUnrecognizedColumns, matchedInternalFields,
  columnDecisions, allResolved,
  updateDecision, handleUnmatch, handleCreateField,
  creatingFields, loading,
  mappingName, setMappingName,
  handleMappedPreview, reset,
}) {
  if (!analyzeData) return null;

  return (
    <div className="csv-upload-panel">
      {error && (
        <div className="csv-error-box" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} color="var(--red-text)" />
          {error}
        </div>
      )}

      {looksLikeLTExport(analyzeData) && (
        <div className="csv-info-box" style={{ marginBottom: 16 }}>
          <Icon name="info" size={15} color="var(--text-2)" />
          This looks like a LicenseTrack export. For automatic column matching without manual mapping, use <strong>Native CSV</strong> mode instead.
        </div>
      )}

      {/* PART A - Auto-matched columns (collapsible) */}
      <div className="mapping-section">
        <button
          type="button"
          className="mapping-matched-header"
          aria-expanded={showMatched}
          aria-controls="mapping-matched-body"
          onClick={() => setShowMatched(v => !v)}
        >
          <Icon name={showMatched ? "chevron-down" : "chevron-right"} size={12} color="var(--green)" />
          ✓ {activeMatchedColumns.length} column{activeMatchedColumns.length !== 1 ? "s" : ""} matched automatically
        </button>
        {showMatched && (
          <div id="mapping-matched-body">
            <table className="mapping-matched-table">
              <thead>
                <tr>
                  <td style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6 }}>Column</td>
                  <td style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6 }}>Mapped to</td>
                  <td style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6 }}>Sample values</td>
                  <td style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6 }}>Action</td>
                </tr>
              </thead>
              <tbody>
                {activeMatchedColumns.map(col => (
                  <tr key={col.rawHeader}>
                    <td>{col.rawHeader}</td>
                    <td><span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>{col.internalField}</span></td>
                    <td>{(col.sampleValues || []).slice(0, 3).join(", ")}</td>
                    <td>
                      <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => handleUnmatch(col)}>
                        Unmatch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PART B - Unrecognized columns */}
      <div className="mapping-section">
        {allUnrecognizedColumns.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-2)" }}>All columns were recognized. No mapping required.</p>
        ) : (
          <>
            <div className="mapping-unrecognized-header">
              Unrecognized Columns — decide what to do with each
            </div>
            {allUnrecognizedColumns.map(col => {
              const decision = columnDecisions[col.rawHeader] || {};
              return (
                <div key={col.rawHeader} className="mapping-row">
                  <div className="mapping-row-top">
                    <div>
                      <div className="mapping-col-name">{col.rawHeader}</div>
                      {(col.sampleValues || []).length > 0 && (
                        <div className="mapping-col-samples">e.g. {col.sampleValues.slice(0, 3).join(", ")}</div>
                      )}
                    </div>
                    <div className="mapping-action-toggle" role="group" aria-label={`Action for ${col.rawHeader}`}>
                      <button type="button" className={`mapping-action-btn${decision.action === "map" ? " active" : ""}`} aria-pressed={decision.action === "map"} onClick={() => updateDecision(col.rawHeader, { action: "map" })}>Map to field</button>
                      <button type="button" className={`mapping-action-btn${decision.action === "create" ? " active" : ""}`} aria-pressed={decision.action === "create"} onClick={() => updateDecision(col.rawHeader, { action: "create" })}>Create custom field</button>
                      <button type="button" className={`mapping-action-btn${decision.action === "skip" ? " active" : ""}`} aria-pressed={decision.action === "skip"} onClick={() => updateDecision(col.rawHeader, { action: "skip" })}>Skip</button>
                    </div>
                  </div>

                  {decision.action === "map" && (
                    <div className="mapping-row-detail">
                      <select className="fi fi-select mapping-field-select" value={decision.targetField} onChange={e => updateDecision(col.rawHeader, { targetField: e.target.value })} aria-label={`Map ${col.rawHeader} to field`}>
                        <option value="">— select a field —</option>
                        {NATIVE_FIELDS.filter(f => !matchedInternalFields.has(f.value)).map(f => (
                          <option key={f.value} value={f.value} disabled={f.disabled ?? false}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {decision.action === "create" && (
                    <div className="mapping-row-detail">
                      {decision.cfKey ? (
                        <div className="mapping-locked-field">
                          <Icon name="check" size={13} color="var(--green)" />
                          <span>{decision.cfName}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>({CUSTOM_FIELD_TYPE_LABELS[decision.cfType] ?? decision.cfType})</span>
                          <span className="mapping-locked-key">{decision.cfKey}</span>
                        </div>
                      ) : (
                        <div className="mapping-create-form">
                          <div className="fg" style={{ flex: "1 1 160px", marginBottom: 0 }}>
                            <label htmlFor={`cf-name-${col.rawHeader}`}>Field name</label>
                            <input id={`cf-name-${col.rawHeader}`} className="fi" type="text" value={decision.cfName} onChange={e => updateDecision(col.rawHeader, { cfName: e.target.value })} />
                          </div>
                          <div className="fg" style={{ flex: "0 0 120px", marginBottom: 0 }}>
                            <label htmlFor={`cf-type-${col.rawHeader}`}>Field type</label>
                            <select id={`cf-type-${col.rawHeader}`} className="fi fi-select" value={decision.cfType} onChange={e => updateDecision(col.rawHeader, { cfType: e.target.value })}>
                              <option value="text">Text</option>
                              <option value="currency">Currency</option>
                              <option value="date">Date</option>
                              <option value="boolean">True/False</option>
                            </select>
                          </div>
                          <button type="button" className="btn btn-g" style={{ fontSize: 12, alignSelf: "flex-end" }} disabled={!decision.cfName.trim() || creatingFields} onClick={() => handleCreateField(col.rawHeader)}>
                            Create Field
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {decision.action === "skip" && (
                    <div className="mapping-row-detail">
                      <span className="mapping-skip-label">This column will not be imported</span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* PART C - Save mapping preset */}
      <div className="mapping-preset-row">
        <label className="mapping-preset-label" htmlFor="mapping-preset-name">
          Save this mapping as a preset (optional)
        </label>
        <input id="mapping-preset-name" className="fi" type="text" placeholder="e.g. Flexera Q1 Export" value={mappingName} onChange={e => setMappingName(e.target.value)} />
      </div>

      {/* PART D - Actions */}
      {analyzeData.missingRequired && analyzeData.missingRequired.length > 0 && (
        <div className="csv-warn-box" style={{ marginTop: 16 }}>
          <Icon name="alert" size={14} color="var(--orange-text)" />
          <span><strong>Warning:</strong> required columns not found: {analyzeData.missingRequired.join(", ")}. Rows missing these fields will be skipped.</span>
        </div>
      )}
      <div className="csv-actions">
        <button className="btn btn-g" onClick={reset}>Cancel</button>
        <button className="btn btn-p" onClick={handleMappedPreview} disabled={!allResolved || creatingFields || loading}>
          <Icon name="table" size={13} /> Preview {analyzeData.totalRows} row{analyzeData.totalRows !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

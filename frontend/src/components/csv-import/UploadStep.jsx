import { downloadCsvTemplate } from "../../api/csvImport.js";
import Icon from "../ui/Icon.jsx";

export default function UploadStep({
  source, setSource,
  savedMappings, selectedMappingId, setSelectedMappingId, loadingMappings,
  importNumberFormatLocale, setImportNumberFormatLocale,
  importDateFormat, setImportDateFormat,
  error, setError,
  dragOver, setDragOver,
  loading,
  fileInputRef,
  handleFile,
}) {
  return (
    <div className="csv-upload-panel">
      <div className="csv-source-row">
        <span className="csv-source-label">Import source</span>
        <div className="csv-source-toggle" role="group" aria-label="Import source">
          <button
            type="button"
            className={`csv-source-btn${source === "standard" ? " active" : ""}`}
            aria-pressed={source === "standard"}
            onClick={() => setSource("standard")}
          >
            Native CSV
          </button>
          <button
            type="button"
            className={`csv-source-btn${source === "external" ? " active" : ""}`}
            aria-pressed={source === "external"}
            onClick={() => setSource("external")}
          >
            External Tool Import
          </button>
        </div>
      </div>

      <div className="csv-preset-row">
        <label htmlFor="import-number-format" className="csv-preset-label">
          Number format in this file
        </label>
        <div className="csv-preset-controls">
          <select
            id="import-number-format"
            className="fi fi-select"
            value={importNumberFormatLocale}
            onChange={(e) => setImportNumberFormatLocale(e.target.value)}
          >
            <option value="en-US">1,234.50 (US / UK)</option>
            <option value="nl-BE">1.234,50 (Belgian / Dutch)</option>
            <option value="de-DE">1.234,50 (German)</option>
            <option value="fr-FR">1 234,50 (French)</option>
          </select>
          <select
            aria-label="Date format in this file"
            className="fi fi-select"
            value={importDateFormat}
            onChange={(e) => setImportDateFormat(e.target.value)}
          >
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>
      </div>

      <div className="csv-dl-row">
        {source === "standard" && (
          <button className="btn btn-g" style={{ fontSize: 12 }} onClick={async () => {
            const { error: err } = await downloadCsvTemplate();
            if (err) setError(err);
          }}>
            <Icon name="download" size={13} /> Download CSV Template
          </button>
        )}
      </div>

      {source === "external" && (
        <div className="csv-preset-row">
          <label htmlFor="mapping-preset-select" className="csv-preset-label">
            Load a saved mapping preset (optional)
          </label>
          <div className="csv-preset-controls">
            <select
              id="mapping-preset-select"
              className="fi fi-select"
              value={selectedMappingId ?? ""}
              onChange={e => setSelectedMappingId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingMappings || savedMappings.length === 0}
            >
              <option value="">
                {loadingMappings ? "Loading presets…" : savedMappings.length === 0 ? "No saved presets" : "— no preset —"}
              </option>
              {savedMappings.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {selectedMappingId && (
              <button type="button" className="btn btn-g" style={{ fontSize: 12 }} onClick={() => setSelectedMappingId(null)}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="csv-error-box">
          <Icon name="alert" size={15} color="var(--red-text)" />
          {error}
        </div>
      )}

      <div
        className={`upload-zone${dragOver ? " drag-over" : ""}${loading ? " processing" : ""}`}
        onClick={() => !loading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f); }}
        />
        {loading
          ? <><div className="spinner" /><h3>Analysing CSV…</h3><p>Parsing and classifying rows</p></>
          : <><Icon name="table" size={26} color="var(--text-3)" /><h3>Drop CSV file here or click to browse</h3><p>Only .csv files are accepted</p></>}
      </div>

      <div className="csv-warn-box">
        <Icon name="alert" size={14} color="var(--orange-text)" />
        <span><strong>Note:</strong> You can review parsed rows, validation issues, and possible duplicates before importing.</span>
      </div>
    </div>
  );
}

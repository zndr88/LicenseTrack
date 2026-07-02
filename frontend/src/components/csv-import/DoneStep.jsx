import Icon from "../ui/Icon.jsx";

export default function DoneStep({ confirmResult, onGoToLicenses, reset }) {
  if (!confirmResult) return null;

  return (
    <div className="csv-done-panel">
      <div className="csv-success-box">
        <Icon name="check" size={32} color="var(--green)" />
        <div className="csv-success-count">
          {confirmResult.importedCount} {confirmResult.importedCount === 1 ? "license" : "licenses"} imported
        </div>
        <div className="csv-success-label">Import complete</div>
        {confirmResult.skippedCount > 0 && (
          <div className="csv-skipped">
            {confirmResult.skippedCount} {confirmResult.skippedCount === 1 ? "row was" : "rows were"} skipped due to errors.
          </div>
        )}
      </div>
      {confirmResult.errors && confirmResult.errors.length > 0 && (
        <div className="tbl-wrap" style={{ marginBottom: 20 }}>
          <div className="csv-skip-hd">Skipped rows</div>
          {confirmResult.errors.map((e) => (
            <div key={e.rowNumber} className="csv-skip-row">
              <span className="mono csv-skip-num">Row {e.rowNumber}</span>
              <span className="csv-skip-reason">{e.reason}</span>
            </div>
          ))}
        </div>
      )}
      <div className="csv-bottom-actions">
        <button className="btn btn-p" onClick={onGoToLicenses}><Icon name="list" size={13} /> View Licenses</button>
        <button className="btn btn-g" onClick={reset}>Import Another File</button>
      </div>
    </div>
  );
}

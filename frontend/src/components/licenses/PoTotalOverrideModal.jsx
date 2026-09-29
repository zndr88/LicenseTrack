import { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import NumberInput, { isValidNumberValue } from "../ui/NumberInput.jsx";

export default function PoTotalOverrideModal({ license, userSettings, onSave, onClear, onClose }) {
  // Canonical value from NumberInput (or the typed text while it's invalid).
  const [value, setValue] = useState(license.poTotalOverride || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    const parsed = value;
    if (!parsed || !isValidNumberValue(parsed)) {
      setError("Enter a valid PO total value.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await onSave(parsed);
    setSaving(false);
    if (!ok) setError("The PO total override could not be saved.");
  };

  const clear = async () => {
    setSaving(true);
    setError(null);
    const ok = await onClear();
    setSaving(false);
    if (!ok) setError("The PO total override could not be cleared.");
  };

  return (
    <ModalShell
      title="Override total PO value"
      titleId="dialog-title-po-total-override"
      onClose={onClose}
      modalStyle={{ width: 420, maxWidth: "92vw" }}
      footer={(
        <>
          <button className="btn btn-g btn-sm" onClick={onClose}>Cancel</button>
          {license.poTotalOverride && (
            <button className="btn btn-g btn-sm" disabled={saving} onClick={clear}>Clear override</button>
          )}
          <button className="btn btn-p btn-sm" disabled={saving} onClick={save}>
            {saving ? "Saving..." : "Save override"}
          </button>
        </>
      )}
    >
      <div className="modal-bd" style={{ paddingBottom: 8 }}>
        <p style={{ marginTop: 0, color: "var(--text-muted)", fontSize: 12 }}>
          This value will apply to every {license.currency || "EUR"} license with PO {license.poNumber}.
          Clear the override to return to the calculated line total.
        </p>
        <div className="fg" style={{ marginBottom: 0 }}>
          <label htmlFor="po-total-override-value">Total PO value ({license.currency || "EUR"})</label>
          <NumberInput
            id="po-total-override-value"
            value={value}
            settings={userSettings}
            minFractionDigits={2}
            onChange={setValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            autoFocus
          />
          {error && <div style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{error}</div>}
        </div>
      </div>
    </ModalShell>
  );
}

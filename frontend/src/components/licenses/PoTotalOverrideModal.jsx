import { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

export default function PoTotalOverrideModal({ license, userSettings, onSave, onClear, onClose }) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const initialValue = license.poTotalOverride || "";
  const [value, setValue] = useState(formatPriceInput(initialValue, locale));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    const parsed = parseLocalizedNumber(value, userSettings);
    if (parsed === null || parsed === undefined || parsed === "") {
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
          This value will apply to every license with PO {license.poNumber}.
          Clear the override to return to the calculated line total.
        </p>
        <div className="fg" style={{ marginBottom: 0 }}>
          <label htmlFor="po-total-override-value">Total PO value ({license.currency || "EUR"})</label>
          <input
            id="po-total-override-value"
            className="fi"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setValue(formatPriceInput(value, locale))}
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

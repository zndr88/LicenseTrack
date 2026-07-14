import { useState } from "react";
import { patchLicenseField } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

/**
 * Single-field edit modal.
 *
 * Props:
 *   licenseId     {number} - license ID
 *   fieldKey      {string} - camelCase field name, e.g. "supplier"
 *   fieldLabel    {string} - human-readable label, e.g. "Supplier"
 *   currentValue  {string} - pre-filled value
 *   inputType     {string} - "text" | "date" | "email" | "number" | "textarea" | "select"
 *   selectOptions {Array} - [{value, label}] required when inputType="select"
 *   onSave        {Function(updatedLicense)} - called on successful save
 *   onClose       {Function} - called to dismiss modal
 */
const PRICE_FIELD_KEYS = ["unitPrice", "totalPoPrice"];
const NUMERIC_FIELD_KEYS = ["quantity", ...PRICE_FIELD_KEYS];

export default function FieldEditModal({
  licenseId,
  fieldKey,
  fieldLabel,
  currentValue,
  inputType,
  selectOptions,
  blankOptionLabel = "—",
  onSave,
  onClose,
  onSaveFn,
  userSettings,
}) {
  const isPriceField = PRICE_FIELD_KEYS.includes(fieldKey);
  const isNumericField = NUMERIC_FIELD_KEYS.includes(fieldKey);
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const initialValue = isPriceField ? formatPriceInput(currentValue ?? "", locale) : (currentValue ?? "");
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isDirty = value !== initialValue;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const saveValue = isNumericField
      ? (parseLocalizedNumber(value, userSettings) ?? "")
      : value;
    const { data, error: apiError } = onSaveFn
      ? await onSaveFn(saveValue)
      : await patchLicenseField(licenseId, fieldKey, saveValue);
    setSaving(false);
    if (apiError) {
      setError(apiError);
      return;
    }
    onSave(data);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && inputType !== "textarea") {
      e.preventDefault();
      handleSave();
    }
    // Escape is handled by useModalGuard's document listener
  };

  return (
    <>
    <ModalShell
      title={fieldLabel}
      titleId="dialog-title-field-edit"
      onClose={requestClose}
      modalStyle={{ width: 400, maxWidth: "92vw" }}
      footer={(
        <>
          <button className="btn btn-g btn-sm" onClick={requestClose}>Cancel</button>
          <button className="btn btn-p btn-sm" disabled={saving} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      )}
    >
      <div className="modal-bd" style={{ paddingBottom: 8 }}>
        <div className="fg" style={{ marginBottom: 0 }}>
          <label>{fieldLabel}</label>

          {inputType === "textarea" ? (
            <textarea
              className="fi"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={5}
              autoFocus
            />
          ) : inputType === "select" ? (
            <select
              className="fi fi-select"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            >
              <option value="">{blankOptionLabel}</option>
              {(selectOptions ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              className="fi"
              type={inputType}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={isPriceField ? () => setValue(formatPriceInput(value, locale)) : undefined}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          )}

          {error && (
            <div style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6, fontFamily: "var(--font-sans)" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
    {showDiscardDialog && (
      <DiscardChangesDialog
        onKeep={() => setShowDiscardDialog(false)}
        onDiscard={onClose}
      />
    )}
    </>
  );
}

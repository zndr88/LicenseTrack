import { useMemo, useState } from "react";
import { updateLicense } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import Icon from "../ui/Icon.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";

function normaliseInvoiceNumbers(values) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function toEditableRows(invoiceNumbers, fallbackPrimary) {
  const rows = normaliseInvoiceNumbers(
    Array.isArray(invoiceNumbers) ? invoiceNumbers : []
  );
  if (rows.length === 0 && fallbackPrimary) rows.push(fallbackPrimary);
  return rows.length > 0 ? rows : [""];
}

export default function InvoiceNumbersModal({
  licenseId,
  invoiceNumbers,
  primaryInvoiceNumber,
  onSave,
  onClose,
}) {
  const initialRows = useMemo(
    () => toEditableRows(invoiceNumbers, primaryInvoiceNumber),
    [invoiceNumbers, primaryInvoiceNumber]
  );
  const [rows, setRows] = useState(initialRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const initialSignature = JSON.stringify(normaliseInvoiceNumbers(initialRows));
  const currentSignature = JSON.stringify(normaliseInvoiceNumbers(rows));
  const isDirty = initialSignature !== currentSignature;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  const setRow = (index, value) => {
    setRows((current) => current.map((row, idx) => (idx === index ? value : row)));
  };

  const addRow = () => setRows((current) => [...current, ""]);

  const removeRow = (index) => {
    setRows((current) => {
      const next = current.filter((_, idx) => idx !== index);
      return next.length > 0 ? next : [""];
    });
  };

  const moveRow = (index, direction) => {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    const nextInvoiceNumbers = normaliseInvoiceNumbers(rows);
    setSaving(true);
    setError(null);
    const { data, error: apiError } = await updateLicense(licenseId, {
      invoiceNumbers: nextInvoiceNumbers,
    });
    setSaving(false);
    if (apiError) {
      setError(apiError);
      return;
    }
    onSave(data);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    }
  };

  return (
    <>
      <ModalShell
        title="Invoice Numbers"
        titleId="dialog-title-invoice-numbers"
        onClose={requestClose}
        modalStyle={{ width: 560, maxWidth: "92vw" }}
        footer={(
          <>
            <button className="btn btn-g btn-sm" onClick={requestClose}>Cancel</button>
            <button className="btn btn-p btn-sm" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      >
        <div className="modal-bd invoice-numbers-modal">
          <div className="invoice-number-rows">
            {rows.map((row, index) => (
              <div className="invoice-number-row" key={index}>
                <div className="fg invoice-number-input">
                  <label>{index === 0 ? "Primary invoice" : "Additional invoice"}</label>
                  <input
                    className="fi mono"
                    value={row}
                    onChange={(event) => setRow(index, event.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus={index === rows.length - 1 && row === ""}
                  />
                </div>
                <div className="invoice-number-actions">
                  <button
                    type="button"
                    className="doc-action-btn"
                    aria-label="Move invoice up"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveRow(index, -1)}
                  >
                    <Icon name="chevron-up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="doc-action-btn"
                    aria-label="Move invoice down"
                    title="Move down"
                    disabled={index === rows.length - 1}
                    onClick={() => moveRow(index, 1)}
                  >
                    <Icon name="chevron-down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="doc-action-btn remove"
                    aria-label="Remove invoice number"
                    title="Remove"
                    onClick={() => removeRow(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-g btn-sm" onClick={addRow}>
            <Icon name="plus" size={12} /> Add invoice number
          </button>

          {error && (
            <div className="invoice-number-error">
              {error}
            </div>
          )}
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

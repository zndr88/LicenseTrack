import { useMemo, useState } from "react";
import { updateLicense } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import InvoiceNumberRows, { normaliseInvoiceNumbers, toEditableRows } from "./InvoiceNumberRows.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";

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
          <InvoiceNumberRows rows={rows} onChange={setRows} onKeyDown={handleKeyDown} autoFocusEmpty />

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

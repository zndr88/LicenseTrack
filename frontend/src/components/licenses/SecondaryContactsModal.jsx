import { useMemo, useState } from "react";
import { updateLicense } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import Icon from "../ui/Icon.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";

function normaliseContacts(values) {
  const seen = new Set();
  const contacts = [];
  values.forEach((value) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push(text);
  });
  return contacts;
}

function toEditableRows(secondaryContacts) {
  const rows = normaliseContacts(Array.isArray(secondaryContacts) ? secondaryContacts : []);
  return rows.length > 0 ? rows : [""];
}

export default function SecondaryContactsModal({
  licenseId,
  primaryContact,
  secondaryContacts,
  onSave,
  onClose,
}) {
  const initialRows = useMemo(
    () => toEditableRows(secondaryContacts),
    [secondaryContacts]
  );
  const [rows, setRows] = useState(initialRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const initialSignature = JSON.stringify(normaliseContacts(initialRows));
  const currentSignature = JSON.stringify(normaliseContacts(rows));
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
    const nextSecondaryContacts = normaliseContacts(rows)
      .filter((contact) => contact.toLowerCase() !== (primaryContact || "").trim().toLowerCase());
    setSaving(true);
    setError(null);
    const { data, error: apiError } = await updateLicense(licenseId, {
      secondaryContacts: nextSecondaryContacts,
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
        title="Secondary Contacts"
        titleId="dialog-title-secondary-contacts"
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
          <div className="secondary-contact-primary">
            <span>Primary budget owner</span>
            <strong>{primaryContact || "Not set"}</strong>
          </div>

          <div className="invoice-number-rows">
            {rows.map((row, index) => (
              <div className="invoice-number-row" key={index}>
                <div className="fg invoice-number-input">
                  <label htmlFor={`secondary-contact-${index}`}>Secondary contact</label>
                  <input
                    id={`secondary-contact-${index}`}
                    className="fi"
                    value={row}
                    placeholder="contact@example.com"
                    onChange={(event) => setRow(index, event.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus={index === rows.length - 1 && row === ""}
                  />
                </div>
                <div className="invoice-number-actions">
                  <button
                    type="button"
                    className="doc-action-btn"
                    aria-label="Move contact up"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveRow(index, -1)}
                  >
                    <Icon name="chevron-up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="doc-action-btn"
                    aria-label="Move contact down"
                    title="Move down"
                    disabled={index === rows.length - 1}
                    onClick={() => moveRow(index, 1)}
                  >
                    <Icon name="chevron-down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="doc-action-btn remove"
                    aria-label="Remove contact"
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
            <Icon name="plus" size={12} /> Add secondary contact
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

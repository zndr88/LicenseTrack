import React, { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

function itemDefaults(item) {
  return {
    id: item.id,
    status: item.status ?? null,
    publisherName: item.publisherName ?? "",
    softwareDescription: item.softwareDescription ?? "",
    licenseType: item.licenseType ?? "",
    quantity: item.quantity ?? "",
    estimatedUnitPrice: item.estimatedUnitPrice ?? "",
    estimatedTotalPrice: item.estimatedTotalPrice ?? "",
    currency: item.currency ?? "EUR",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    notes: item.notes ?? "",
  };
}

export default function SourcingRequestEditModal({ request, onSave, onCancel }) {
  const [supplier, setSupplier] = useState(request.supplier ?? "");
  const [contactEmail, setContactEmail] = useState(request.contactEmail ?? "");
  const [notes, setNotes] = useState(request.notes ?? "");
  const [items, setItems] = useState((request.items ?? []).map(itemDefaults));
  const [saving, setSaving] = useState(false);

  const updateItem = (id, field, value) => {
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, [field]: value } : item
    )));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave({ supplier, contactEmail, notes, items });
      if (saved) onCancel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Edit Sourcing Request"
      titleId="dialog-title-sourcing-request-edit"
      onClose={onCancel}
      modalStyle={{ maxWidth: "min(760px, 94vw)" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-p" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Sourcing Request"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <div className="fr">
          <div className="fg">
            <label htmlFor="sourcing-request-supplier">Supplier</label>
            <ReferenceCombobox id="sourcing-request-supplier" mode="supplier" value={supplier} onChange={setSupplier} />
          </div>
          <div className="fg">
            <label htmlFor="sourcing-request-contact">Supplier Contact</label>
            <input id="sourcing-request-contact" className="fi" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
          </div>
        </div>
        <div className="fg">
          <label htmlFor="sourcing-request-notes">Request Notes</label>
          <textarea id="sourcing-request-notes" className="fi" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        <div className="fs" style={{ marginTop: 14 }}>
          <h4>Line Items</h4>
          <p style={{ fontSize: 11, color: "var(--text-3)" }}>Changes to open lines are saved with the request. Converted or cancelled lines remain read-only.</p>
        </div>
        {items.map((item) => {
          const readOnly = item.status === "converted" || item.status === "cancelled";
          return (
            <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12, marginBottom: 10, opacity: readOnly ? 0.65 : 1 }}>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-publisher`}>Publisher</label>
                  <ReferenceCombobox id={`sourcing-request-item-${item.id}-publisher`} mode="publisher" value={item.publisherName} disabled={readOnly} onChange={(value) => updateItem(item.id, "publisherName", value)} />
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-description`}>Software Description</label>
                  <input id={`sourcing-request-item-${item.id}-description`} className="fi" value={item.softwareDescription} disabled={readOnly} onChange={(event) => updateItem(item.id, "softwareDescription", event.target.value)} />
                </div>
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-type`}>License Type</label>
                  <input id={`sourcing-request-item-${item.id}-type`} className="fi" value={item.licenseType} disabled={readOnly} onChange={(event) => updateItem(item.id, "licenseType", event.target.value)} />
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-quantity`}>Quantity</label>
                  <input id={`sourcing-request-item-${item.id}-quantity`} className="fi" value={item.quantity} disabled={readOnly} onChange={(event) => updateItem(item.id, "quantity", event.target.value)} />
                </div>
                <div className="fg">
                  <label htmlFor={`sourcing-request-item-${item.id}-currency`}>Currency</label>
                  <input id={`sourcing-request-item-${item.id}-currency`} className="fi" value={item.currency} disabled={readOnly} onChange={(event) => updateItem(item.id, "currency", event.target.value)} />
                </div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-unit`}>Estimated Unit Price</label><input id={`sourcing-request-item-${item.id}-unit`} className="fi" value={item.estimatedUnitPrice} disabled={readOnly} onChange={(event) => updateItem(item.id, "estimatedUnitPrice", event.target.value)} /></div>
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-total`}>Estimated Total Price</label><input id={`sourcing-request-item-${item.id}-total`} className="fi" value={item.estimatedTotalPrice} disabled={readOnly} onChange={(event) => updateItem(item.id, "estimatedTotalPrice", event.target.value)} /></div>
              </div>
              <div className="fr">
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-start`}>Start Date</label><input id={`sourcing-request-item-${item.id}-start`} type="date" className="fi" value={item.startDate} disabled={readOnly} onChange={(event) => updateItem(item.id, "startDate", event.target.value)} /></div>
                <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-end`}>End Date</label><input id={`sourcing-request-item-${item.id}-end`} type="date" className="fi" value={item.endDate} disabled={readOnly} onChange={(event) => updateItem(item.id, "endDate", event.target.value)} /></div>
              </div>
              <div className="fg"><label htmlFor={`sourcing-request-item-${item.id}-notes`}>Line Notes</label><textarea id={`sourcing-request-item-${item.id}-notes`} className="fi" rows={2} value={item.notes} disabled={readOnly} onChange={(event) => updateItem(item.id, "notes", event.target.value)} /></div>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

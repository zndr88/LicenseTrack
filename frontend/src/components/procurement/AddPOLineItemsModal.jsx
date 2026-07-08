import React, { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"];

const emptyItem = () => ({
  publisherName: "",
  softwareDescription: "",
  quantity: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  supplier: "",
  contactEmail: "",
});

const AddPOLineItemsModal = ({ po, onSave, onCancel, saving, userSettings }) => {
  const [items, setItems] = useState([emptyItem()]);
  const locale = userSettings?.numberFormatLocale ?? "en-US";

  const update = (idx, field, value) =>
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "estimatedUnitPrice" || field === "quantity") {
        const qtyRaw = field === "quantity" ? value : item.quantity;
        const unitRaw = field === "estimatedUnitPrice" ? value : item.estimatedUnitPrice;
        const qty = parseFloat(parseLocalizedNumber(qtyRaw, userSettings) ?? qtyRaw);
        const unit = parseFloat(parseLocalizedNumber(unitRaw, userSettings) ?? unitRaw);
        if (!isNaN(qty) && qty > 0 && !isNaN(unit) && unit > 0) {
          updated.estimatedTotalPrice = formatPriceInput(String(qty * unit), locale);
        }
      }
      return updated;
    }));

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (idx) =>
    setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const canSave = items.every(
    (item) => item.publisherName.trim() !== "" && item.softwareDescription.trim() !== ""
  );

  const isDirty = items.some(
    (item) => item.publisherName || item.softwareDescription || item.quantity || item.estimatedUnitPrice || item.supplier || item.contactEmail
  );
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

  const handleSubmit = () => {
    if (!canSave || saving) return;
    onSave(items.map((item) => ({
      ...item,
      quantity: parseLocalizedNumber(item.quantity, userSettings) ?? item.quantity,
      estimatedUnitPrice: parseLocalizedNumber(item.estimatedUnitPrice, userSettings) ?? item.estimatedUnitPrice,
      estimatedTotalPrice: parseLocalizedNumber(item.estimatedTotalPrice, userSettings) ?? item.estimatedTotalPrice,
    })));
  };

  return (
    <>
    <ModalShell
      title="Add License Items"
      titleId="dialog-title-add-po-items"
      onClose={requestClose}
      modalStyle={{ maxWidth: "min(680px, 96vw)" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
          <button className="btn btn-p" onClick={handleSubmit} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save to PO"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 12px" }}>
          Adding items to <strong>{po.poNumber}</strong>. The PO will not be converted yet — use the Convert button when ready.
        </p>
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "12px 14px",
              marginBottom: 10,
              background: "var(--bg-2)",
            }}
          >
            {items.length > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Item {idx + 1}</span>
                <button
                  type="button"
                  className="btn btn-g"
                  style={{ padding: "2px 6px", fontSize: 11 }}
                  onClick={() => removeItem(idx)}
                >
                  Remove
                </button>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              <div className="fg" style={{ gridColumn: "1 / -1" }}>
                <label>Publisher <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  className="fi"
                  placeholder="e.g. Adobe"
                  value={item.publisherName}
                  onChange={(e) => update(idx, "publisherName", e.target.value)}
                />
              </div>
              <div className="fg" style={{ gridColumn: "1 / -1" }}>
                <label>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  className="fi"
                  placeholder="e.g. Adobe Creative Cloud All Apps"
                  value={item.softwareDescription}
                  onChange={(e) => update(idx, "softwareDescription", e.target.value)}
                />
              </div>
              <div className="fg">
                <label>Purchase Quantity</label>
                <input
                  className="fi"
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  value={item.quantity}
                  onChange={(e) => update(idx, "quantity", e.target.value)}
                />
              </div>
              <div className="fg">
                <label>Currency</label>
                <select
                  className="fi"
                  value={item.currency}
                  onChange={(e) => update(idx, "currency", e.target.value)}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Est. Unit Price</label>
                <input
                  className="fi"
                  inputMode="decimal"
                  placeholder={`e.g. ${formatPriceInput("500", locale)}`}
                  value={item.estimatedUnitPrice}
                  onChange={(e) => update(idx, "estimatedUnitPrice", e.target.value)}
                />
              </div>
              <div className="fg">
                <label>Est. Total Price</label>
                <input
                  className="fi"
                  inputMode="decimal"
                  placeholder={`e.g. ${formatPriceInput("5000", locale)}`}
                  value={item.estimatedTotalPrice}
                  onChange={(e) => update(idx, "estimatedTotalPrice", e.target.value)}
                />
              </div>
              <div className="fg">
                <label>Supplier</label>
                <input
                  className="fi"
                  placeholder="e.g. SoftwareOne"
                  value={item.supplier}
                  onChange={(e) => update(idx, "supplier", e.target.value)}
                />
              </div>
              <div className="fg">
                <label>Contact Email</label>
                <input
                  className="fi"
                  type="email"
                  placeholder="e.g. rep@softwareone.com"
                  value={item.contactEmail}
                  onChange={(e) => update(idx, "contactEmail", e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-g"
          style={{ fontSize: 12, marginTop: 2 }}
          onClick={addItem}
          disabled={saving}
        >
          + Add another item
        </button>
      </div>
    </ModalShell>
    {showDiscardDialog && (
      <DiscardChangesDialog
        onKeep={() => setShowDiscardDialog(false)}
        onDiscard={onCancel}
      />
    )}
    </>
  );
};

export default AddPOLineItemsModal;

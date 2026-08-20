import React, { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import { pendingOrderLabel } from "../../utils/procurementLabels.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

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
            {saving ? "Saving..." : "Save to Pending Order"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 12px" }}>
          Adding items to <strong>{pendingOrderLabel(po)}</strong>. The pending order will not be converted yet - use Convert when ready.
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
                <label htmlFor={`po-line-${idx}-publisher`}>Publisher <span style={{ color: "var(--red)" }}>*</span></label>
                <ReferenceCombobox
                  id={`po-line-${idx}-publisher`}
                  mode="publisher"
                  placeholder="Software publisher"
                  value={item.publisherName}
                  onChange={(value) => update(idx, "publisherName", value)}
                />
              </div>
              <div className="fg" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor={`po-line-${idx}-software`}>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  id={`po-line-${idx}-software`}
                  className="fi"
                  placeholder="Product or service name"
                  value={item.softwareDescription}
                  onChange={(e) => update(idx, "softwareDescription", e.target.value)}
                />
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-quantity`}>Purchase Quantity</label>
                <input
                  id={`po-line-${idx}-quantity`}
                  className="fi"
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  value={item.quantity}
                  onChange={(e) => update(idx, "quantity", e.target.value)}
                />
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-currency`}>Currency</label>
                <select
                  id={`po-line-${idx}-currency`}
                  className="fi"
                  value={item.currency}
                  onChange={(e) => update(idx, "currency", e.target.value)}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-unit-price`}>Est. Unit Price</label>
                <input
                  id={`po-line-${idx}-unit-price`}
                  className="fi"
                  inputMode="decimal"
                  placeholder={`e.g. ${formatPriceInput("500", locale)}`}
                  value={item.estimatedUnitPrice}
                  onChange={(e) => update(idx, "estimatedUnitPrice", e.target.value)}
                />
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-total-price`}>Est. Total Price</label>
                <input
                  id={`po-line-${idx}-total-price`}
                  className="fi"
                  inputMode="decimal"
                  placeholder={`e.g. ${formatPriceInput("5000", locale)}`}
                  value={item.estimatedTotalPrice}
                  onChange={(e) => update(idx, "estimatedTotalPrice", e.target.value)}
                />
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-supplier`}>Supplier</label>
                <ReferenceCombobox
                  id={`po-line-${idx}-supplier`}
                  mode="supplier"
                  placeholder="Reseller or direct supplier"
                  value={item.supplier}
                  onChange={(value) => update(idx, "supplier", value)}
                />
              </div>
              <div className="fg">
                <label htmlFor={`po-line-${idx}-contact`}>Contact Email</label>
                <input
                  id={`po-line-${idx}-contact`}
                  className="fi"
                  type="email"
                  placeholder="contact@example.com"
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

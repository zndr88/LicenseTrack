import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { poFormSchema } from "../../utils/procurementSchemas.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import Icon from "../ui/Icon.jsx";
import PluginSlot from "../plugins/PluginSlot.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"];

const emptyItem = () => ({
  id: `${Date.now()}-${Math.random()}`,
  publisherName: "",
  softwareDescription: "",
  quantity: "",
  estimatedUnitPrice: "",
  estimatedTotalPrice: "",
  currency: "EUR",
  supplier: "",
  contactEmail: "",
});

const PendingOrderModal = ({ order, userSettings, onSave, onCancel }) => {
  const isNewOrder = !order;
  const locale = userSettings?.numberFormatLocale ?? "en-US";

  const {
    register,
    handleSubmit,
    formState: { isDirty },
    watch,
    reset,
    setValue,
  } = useForm({
    resolver: zodResolver(poFormSchema),
    defaultValues: {
      poNumber: order?.poNumber ?? "",
      supplier: order?.supplier ?? "",
      notes:    order?.notes    ?? "",
    },
  });

  const [items, setItems] = useState([emptyItem()]);
  const [attachedFile, setAttachedFile] = useState(null);
  const [attachedFileBase64, setAttachedFileBase64] = useState(null);
  const [slotHasActions, setSlotHasActions] = useState(false);
  const [saving, setSaving] = useState(false);

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

  const poNumberVal = watch("poNumber");
  const canSave = (poNumberVal ?? "").trim() !== "";

  const handleFileChange = (file) => {
    setAttachedFile(file);
    if (!file) { setAttachedFileBase64(null); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachedFileBase64(reader.result.split(",")[1] ?? null);
    reader.readAsDataURL(file);
  };

  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
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
  const removeItem = (id) => setItems((prev) => prev.length > 1 ? prev.filter((i) => i.id !== id) : prev);

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (isNewOrder) {
        const saved = await onSave({ ...data, items, quoteFile: attachedFile || null });
        if (saved) {
          reset();
          setItems([emptyItem()]);
          handleFileChange(null);
        }
      } else {
        const saved = await onSave(data);
        if (saved) reset();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ModalShell
        title={order ? "Edit Pending Order" : "Add Pending Order"}
        titleId="dialog-title-pending-order"
        onClose={requestClose}
        modalStyle={{ maxWidth: isNewOrder ? "min(640px, 96vw)" : "min(480px, 92vw)" }}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={saving}>Cancel</button>
            <button className="btn btn-p" disabled={!canSave || saving} onClick={handleSubmit(onSubmit)}>
              {saving ? "Saving..." : isNewOrder && items.filter((i) => i.publisherName.trim()).length > 0
                ? `Save PO + ${items.filter((i) => i.publisherName.trim()).length} Item${items.filter((i) => i.publisherName.trim()).length > 1 ? "s" : ""}`
                : "Save"}
            </button>
          </>
        )}
      >
        <div className="modal-bd">
          {/* Plugin slot — always mounted so it can discover actions; visually hidden when no actions */}
          {isNewOrder && (
            <div className="plugin-slot-form-row" style={slotHasActions ? undefined : { display: "none" }}>
              <PluginSlot
                slot="pendingOrder.add.actions"
                context={{
                  targetType: "pending_order_draft",
                  targetId: "new",
                  ...(attachedFileBase64 ? {
                    fileContentBase64: attachedFileBase64,
                    fileName: attachedFile?.name,
                    contentType: attachedFile?.type || "application/pdf",
                  } : {}),
                }}
                onActionsLoaded={(count) => setSlotHasActions(count > 0)}
                onResult={(result) => {
                  const mis = result?.multiItems;
                  if (!Array.isArray(mis) || mis.length === 0) return;
                  const first = mis[0];
                  if (first.poNumber) setValue("poNumber", first.poNumber, { shouldDirty: true });
                  if (first.supplier) setValue("supplier", first.supplier, { shouldDirty: true });
                  setItems(mis.map((item) => ({
                    id: `${Date.now()}-${Math.random()}`,
                    publisherName: item.publisherName ?? "",
                    softwareDescription: item.softwareDescription ?? "",
                    quantity: item.quantity ?? "",
                    estimatedUnitPrice: item.estimatedUnitPrice ?? "",
                    estimatedTotalPrice: item.estimatedTotalPrice ?? "",
                    currency: item.currency ?? first.currency ?? "EUR",
                    supplier: item.supplier ?? first.supplier ?? "",
                    contactEmail: item.contactEmail ?? "",
                  })));
                }}
              />
            </div>
          )}

          {/* Document upload — always shown in new-PO mode */}
          {isNewOrder && (
            <div className="fg" style={{ marginBottom: 4 }}>
              <label>Upload Purchase Order Document <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span></label>
              {attachedFile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Icon name="file" size={14} color="var(--text-2)" />
                  <span style={{ fontSize: 12, color: "var(--text-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachedFile.name}</span>
                  <button type="button" className="btn btn-g" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => handleFileChange(null)}>Remove</button>
                </div>
              ) : (
                <input type="file" className="fi" style={{ marginTop: 4 }} accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
              )}
            </div>
          )}

          {/* PO header fields */}
          <div className="fg">
            <label htmlFor="po-number">PO Number <span style={{ color: "var(--red)" }}>*</span></label>
            <input id="po-number" className="fi" placeholder="e.g. PO-2026-0042" {...register("poNumber")} />
          </div>
          <div className="fg">
            <label htmlFor="po-supplier">Supplier</label>
            <input id="po-supplier" className="fi" placeholder="e.g. SoftwareOne" {...register("supplier")} />
          </div>
          <div className="fg">
            <label htmlFor="po-notes">Notes</label>
            <textarea id="po-notes" className="fi" rows={2} placeholder="Any notes..." style={{ resize: "vertical" }} {...register("notes")} />
          </div>

          {/* Inline line items — new order only */}
          {isNewOrder && (
            <div style={{ borderTop: "1px solid var(--border-lt)", paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>License Line Items <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional — add now or after saving)</span></span>
              </div>
              {items.map((item, idx) => (
                <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", marginBottom: 8, background: "var(--bg-2)" }}>
                  {items.length > 1 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>Item {idx + 1}</span>
                      <button type="button" className="btn btn-g" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => removeItem(item.id)}>
                        <Icon name="x" size={11} /> Remove
                      </button>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                    <div className="fg" style={{ gridColumn: "1 / -1" }}>
                      <label>Publisher</label>
                      <input className="fi" placeholder="e.g. Adobe" value={item.publisherName} onChange={(e) => updateItem(item.id, "publisherName", e.target.value)} />
                    </div>
                    <div className="fg" style={{ gridColumn: "1 / -1" }}>
                      <label>Software Description</label>
                      <input className="fi" placeholder="e.g. Adobe Creative Cloud All Apps" value={item.softwareDescription} onChange={(e) => updateItem(item.id, "softwareDescription", e.target.value)} />
                    </div>
                    <div className="fg">
                      <label>Qty</label>
                      <input className="fi" inputMode="decimal" placeholder="e.g. 10" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} />
                    </div>
                    <div className="fg">
                      <label>Currency</label>
                      <select className="fi fi-select" value={item.currency} onChange={(e) => updateItem(item.id, "currency", e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="fg">
                      <label>Unit Price</label>
                      <input className="fi" inputMode="decimal" placeholder={`e.g. ${formatPriceInput("500", locale)}`} value={item.estimatedUnitPrice} onChange={(e) => updateItem(item.id, "estimatedUnitPrice", e.target.value)} />
                    </div>
                    <div className="fg">
                      <label>Total Price</label>
                      <input className="fi" inputMode="decimal" placeholder={`e.g. ${formatPriceInput("5000", locale)}`} value={item.estimatedTotalPrice} onChange={(e) => updateItem(item.id, "estimatedTotalPrice", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-g" style={{ fontSize: 12, marginTop: 2 }} onClick={addItem}>
                <Icon name="plus" size={12} /> Add another item
              </button>
            </div>
          )}
        </div>
      </ModalShell>
      {showDiscardDialog && (
        <DiscardChangesDialog
          onDiscard={() => { reset(); onCancel(); }}
          onKeep={() => setShowDiscardDialog(false)}
        />
      )}
    </>
  );
};

export default PendingOrderModal;

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getPendingOrders } from "../../api/pendingOrders.js";
import { poFormSchema } from "../../utils/procurementSchemas.js";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import { pendingOrderOptionLabel } from "../../utils/procurementLabels.js";

const sourcingPoFormSchema = poFormSchema.extend({
  supplier: z.string().trim().min(1, "Supplier is required."),
});

const ConvertSourcingModal = ({ item, onConfirm, onCancel }) => {
  const [mode, setMode] = useState("new"); // "new" | "existing"
  const [modeEverChanged, setModeEverChanged] = useState(false);
  const [localOrders, setLocalOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [converting, setConverting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { isDirty },
    watch,
    reset,
  } = useForm({
    resolver: zodResolver(sourcingPoFormSchema),
    defaultValues: {
      poNumber: "",
      procurementReference: "",
      supplier: item.supplier ?? "",
      notes:    "",
    },
  });

  // Combined dirty: either RHF fields changed, or the mode was switched.
  const combinedDirty = isDirty || modeEverChanged;

  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty: combinedDirty, onClose: onCancel });

  useEffect(() => {
    getPendingOrders().then(({ data }) => {
      const orders = (data ?? []).filter((order) => (order.supplier ?? "").trim() !== "");
      setLocalOrders(orders);
      if (orders.length > 0) setSelectedOrderId(orders[0].id);
      setLoadingOrders(false);
    });
  }, []);

  const switchMode = (newMode) => {
    if (newMode !== mode) setModeEverChanged(true);
    setMode(newMode);
  };

  const supplierVal = watch("supplier");
  const canConfirm = mode === "new"
    ? (supplierVal ?? "").trim() !== ""
    : selectedOrderId !== "";

  const handleConfirm = () => {
    if (mode === "new") {
      handleSubmit(async (data) => {
        setConverting(true);
        try {
          const converted = await onConfirm({
            poNumber: data.poNumber.trim(),
            procurementReference: data.procurementReference.trim(),
            supplier: data.supplier || null,
            notes: data.notes || null,
          });
          if (converted) reset();
        } finally {
          setConverting(false);
        }
      })();
    } else {
      setConverting(true);
      Promise.resolve(onConfirm({ pendingOrderId: Number(selectedOrderId) }))
        .catch(() => false)
        .finally(() => setConverting(false));
    }
  };

  return (
    <>
      <ModalShell
        title="Convert to Pending Order"
        titleId="dialog-title-convert-sourcing"
        onClose={requestClose}
        modalStyle={{ maxWidth: "min(520px, 92vw)" }}
        footer={(
          <>
            <button className="btn btn-g" onClick={requestClose} disabled={converting}>Cancel</button>
            <button className="btn btn-p" disabled={!canConfirm || converting} onClick={handleConfirm}>
              {converting ? "Converting..." : "Convert"}
            </button>
          </>
        )}
      >
        <div className="modal-bd">
          <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 14, padding: "8px 12px", background: "var(--bg-2)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
            Converting: <strong style={{ color: "var(--text)" }}>{item.supplier || "Sourcing request"} · {item.items?.length ?? 1} license line{(item.items?.length ?? 1) === 1 ? "" : "s"}</strong>
          </div>
          <div className="fr" style={{ marginBottom: 14 }}>
            <button onClick={() => switchMode("new")} style={{ flex: 1, padding: "10px 12px", borderRadius: "var(--r)", border: "1px solid", borderColor: mode === "new" ? "var(--accent)" : "var(--border)", background: mode === "new" ? "var(--accent-m)" : "var(--bg-2)", color: mode === "new" ? "var(--accent)" : "var(--text-2)", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)" }}>
              Create Pending Order
            </button>
            <button onClick={() => switchMode("existing")} disabled={loadingOrders || localOrders.length === 0} style={{ flex: 1, padding: "10px 12px", borderRadius: "var(--r)", border: "1px solid", borderColor: mode === "existing" ? "var(--accent)" : "var(--border)", background: mode === "existing" ? "var(--accent-m)" : "var(--bg-2)", color: mode === "existing" ? "var(--accent)" : (loadingOrders || localOrders.length === 0) ? "var(--text-3)" : "var(--text-2)", cursor: (loadingOrders || localOrders.length === 0) ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)", opacity: (loadingOrders || localOrders.length === 0) ? 0.5 : 1 }}>
              Add to Existing
            </button>
          </div>

          {mode === "new" ? (
            <>
              <div className="fg">
                <label htmlFor="cs-po-number">PO Number</label>
                <input id="cs-po-number" className="fi" placeholder="e.g. PO-2026-0042" {...register("poNumber")} />
              </div>
              <div className="fg">
                <label htmlFor="cs-procurement-reference">Procurement reference</label>
                <input id="cs-procurement-reference" className="fi" placeholder="e.g. REQ-2026-0042" {...register("procurementReference")} />
              </div>
              <div className="fg">
                <label htmlFor="cs-supplier">Supplier <span style={{ color: "var(--red)" }}>*</span></label>
                <input id="cs-supplier" className="fi" placeholder="Reseller or direct supplier" {...register("supplier")} />
              </div>
              <div className="fg">
                <label htmlFor="cs-notes">Notes</label>
                <textarea id="cs-notes" className="fi" rows={2} placeholder="PO notes" style={{ resize: "vertical" }} {...register("notes")} />
              </div>
            </>
          ) : (
            <div className="fg">
              <label htmlFor="cs-select-order">Select Pending Order</label>
              {loadingOrders ? (
                <div className="fi" style={{ color: "var(--text-3)", pointerEvents: "none" }}>Loading pending orders...</div>
              ) : localOrders.length === 0 ? (
                <div className="fi" style={{ color: "var(--text-3)", pointerEvents: "none" }}>No existing pending orders — create a new one below</div>
              ) : (
                <select id="cs-select-order" className="fi" value={selectedOrderId} onChange={(e) => setSelectedOrderId(Number(e.target.value))}>
                  {localOrders.map((o) => (
                    <option key={o.id} value={o.id}>{pendingOrderOptionLabel(o)}</option>
                  ))}
                </select>
              )}
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

export default ConvertSourcingModal;

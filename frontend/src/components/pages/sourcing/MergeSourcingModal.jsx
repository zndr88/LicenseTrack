import Icon from "../../ui/Icon.jsx";
import ModalShell from "../../ui/ModalShell.jsx";
import DiscardChangesDialog from "../../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../../hooks/useModalGuard.js";
import {
  canonicalizePositiveQuantityInput,
  formatQuantity,
} from "../../../utils/quantity.js";

export default function MergeSourcingModal({
  selectedItems,
  licenses,
  computedMergeQty,
  mergeQuantity,
  setMergeQuantity,
  merging,
  onClose,
  onMerge,
  userSettings,
}) {
  const canonicalMergeQuantity = canonicalizePositiveQuantityInput(mergeQuantity, userSettings);
  const mergeQuantityValid = canonicalMergeQuantity != null;
  const isDirty = !merging && canonicalMergeQuantity !== computedMergeQty;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  return (
    <>
    <ModalShell
      title="Merge Renewal Sourcing Items"
      titleId="dialog-title-merge-sourcing"
      onClose={merging ? onClose : requestClose}
      closeOnOverlayClick={!merging}
      closeButtonDisabled={merging}
      modalStyle={{ maxWidth: "min(540px, 92vw)" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={requestClose} disabled={merging}>
            Cancel
          </button>
          <button
            className="btn btn-p"
            style={{ background: "var(--purple-dim)", borderColor: "var(--purple-border)", color: "var(--purple-text)" }}
            onClick={onMerge}
            disabled={merging || !mergeQuantityValid}
          >
            {merging ? (
              <><div className="spinner" style={{ margin: 0, width: 13, height: 13 }} /> Merging...</>
            ) : (
              <><Icon name="check" size={13} /> Merge</>
            )}
          </button>
        </>
      )}
    >
      <div className="modal-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>Items to merge</div>
          {selectedItems.map((si) => {
            const pred = licenses.find((l) => l.id === si.renewalForLicenseId);
            return (
              <div key={si.id} style={{
                padding: "9px 12px", borderRadius: "var(--r)", border: "1px solid var(--border)",
                background: "var(--bg-2)", marginBottom: 6,
                display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{si.publisherName}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1 }}>{si.softwareDescription}</div>
                  {pred && (
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                      License: {pred.softwareDescription} - ends {pred.endDate || "perpetual"}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap", textAlign: "right" }}>
                  <div>Qty: <strong>{formatQuantity(si.quantity, userSettings) || "-"}</strong></div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 13, color: "var(--text-2)", padding: "8px 12px", background: "var(--bg-2)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
          Combined quantity: <strong>{formatQuantity(computedMergeQty, userSettings) || "-"}</strong>
        </div>

        <div>
          <label htmlFor="merge-final-quantity" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
            Final quantity for merged item
          </label>
          <input
            id="merge-final-quantity"
            className="fi"
            type="text"
            inputMode="decimal"
            value={mergeQuantity}
            onChange={(e) => setMergeQuantity(e.target.value)}
            aria-invalid={!mergeQuantityValid}
            aria-describedby={!mergeQuantityValid ? "merge-final-quantity-error" : undefined}
            style={{ width: 120, fontSize: 13 }}
          />
          {!mergeQuantityValid && (
            <div id="merge-final-quantity-error" style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>
              Enter a valid quantity greater than zero.
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            Adjust if the renewal includes a seat count change.
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 12px", background: "var(--bg-2)", borderRadius: "var(--r)", border: "1px solid var(--border)", lineHeight: 1.6 }}>
          The oldest linked license will be used as the primary predecessor.
          All linked licenses will be marked as Renewed on conversion.
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

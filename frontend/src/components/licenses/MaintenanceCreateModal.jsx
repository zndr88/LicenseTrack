import { useState } from "react";
import { createLicense } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

/**
 * Modal for creating a separately tracked maintenance/support contract.
 */
export default function MaintenanceCreateModal({
  parentLicense,
  userSettings,
  onSuccess,
  onClose,
}) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const [endDate, setEndDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [costRaw, setCostRaw] = useState("");
  const [costDisplay, setCostDisplay] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [supplier, setSupplier] = useState(parentLicense.supplier || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canSave = endDate.trim() !== "" && !saving;

  const isDirty = endDate !== "" || startDate !== "" || costRaw !== "" || poNumber !== "" || contractNumber !== "" || supplier !== (parentLicense.supplier || "");
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const costSave = costRaw ? (parseLocalizedNumber(costRaw, userSettings) ?? "") : "";

    const payload = {
      publisherName: parentLicense.publisherName,
      softwareDescription: `${parentLicense.softwareDescription} - Maintenance`,
      licenseType: "maintenance",
      licenseMetric: parentLicense.licenseMetric || "per_user",
      parentLicenseId: parentLicense.id,
      startDate: startDate || null,
      endDate,
      quantity: parentLicense.quantity || "1",
      unitPrice: costSave,
      totalPoPrice: costSave,
      currency: parentLicense.currency || userSettings?.displayCurrency || "EUR",
      poNumber,
      contractNumber,
      supplier,
      contactEmail: parentLicense.contactEmail || "",
      budgetOwnerEmail: parentLicense.budgetOwnerEmail || "",
      costCentre: parentLicense.costCentre || "",
    };

    const { error: apiError } = await createLicense(payload);
    setSaving(false);
    if (apiError) {
      setError(apiError);
      return;
    }
    onSuccess(parentLicense.id);
  };

  return (
    <>
    <ModalShell
      title="Add Maintenance / Support Contract"
      titleId="dialog-title-maintenance-create"
      onClose={requestClose}
      modalStyle={{ width: 480, maxWidth: "min(480px, 92vw)" }}
      footer={(
        <>
          <button type="button" className="btn btn-g btn-sm" onClick={requestClose}>Cancel</button>
          <button type="button" className="btn btn-p btn-sm" disabled={!canSave} onClick={handleSave}>
            {saving ? "Saving..." : "Create Maintenance / Support Record"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.5 }}>
          A new maintenance / support contract record will be created and linked to{" "}
          <strong>{parentLicense.publisherName} - {parentLicense.softwareDescription}</strong>.
          You can edit additional fields after creation by opening the linked record.
        </p>

        <div className="fg">
          <label htmlFor="maint-end-date">End Date *</label>
          <input
            id="maint-end-date"
            className="fi"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            autoFocus
          />
        </div>

        <div className="fg">
          <label htmlFor="maint-start-date">Start Date</label>
          <input
            id="maint-start-date"
            className="fi"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="fg">
          <label htmlFor="maint-cost">Annual Cost</label>
          <input
            id="maint-cost"
            className="fi"
            value={costDisplay}
            onFocus={() => setCostDisplay(costRaw)}
            onChange={(e) => {
              setCostDisplay(e.target.value);
              setCostRaw(e.target.value);
            }}
            onBlur={() => setCostDisplay(formatPriceInput(costRaw, locale))}
            placeholder="e.g. 2500.00"
          />
        </div>

        <div className="fr">
          <div className="fg">
            <label htmlFor="maint-po">PO Number</label>
            <input
              id="maint-po"
              className="fi"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
            />
          </div>
          <div className="fg">
            <label htmlFor="maint-contract">Contract Number</label>
            <input
              id="maint-contract"
              className="fi"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="fg">
          <label htmlFor="maint-supplier">Supplier</label>
          <input
            id="maint-supplier"
            className="fi"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </div>

        {error && (
          <div style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6, fontFamily: "var(--font-sans)" }}>
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

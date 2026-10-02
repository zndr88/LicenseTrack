import { useMemo, useState } from "react";
import { createLicense, linkMaintenanceToParent } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import LicenseFormSection from "./LicenseFormSection.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import Icon from "../ui/Icon.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatDate, toInputText } from "../../utils/formatting.js";
import NumberInput, { isValidNumberValue } from "../ui/NumberInput.jsx";
import LinkPicker from "../ui/LinkPicker.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { useAllLicenses } from "../../hooks/useAllLicenses.js";
import {
  coversConfirmMessage,
  isHiddenFromLinking,
  isLinkedToParent,
  maintenanceCandidate,
} from "../../utils/maintenanceLinking.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import { uploadDocument } from "../../api/documents.js";
import DocumentStagingWorkspace from "../procurement/DocumentStagingWorkspace.jsx";
import { useStagedDocumentAttachments } from "../procurement/useStagedDocumentAttachments.js";
import { unitPriceFromTotal } from "../../utils/lineAmount.js";

/**
 * Modal for creating or linking a separately tracked maintenance/support contract.
 */
export default function MaintenanceCreateModal({
  parentLicense,
  userSettings,
  onSuccess,
  onClose,
}) {
  const [mode, setMode] = useState("create");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Canonical cost from NumberInput (or the typed text while it's invalid).
  const [costRaw, setCostRaw] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [supplier, setSupplier] = useState(parentLicense.supplier || "");
  const { licenses: allLicenses } = useAllLicenses();
  const [showHidden, setShowHidden] = useState(false);
  const [confirmCovers, setConfirmCovers] = useState(null);
  const [selectedMaintenanceId, setSelectedMaintenanceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [createdLicenseId, setCreatedLicenseId] = useState(null);
  const { attachments, categoryScopes, addFiles, removeAttachment, changeCategoryScope } = useStagedDocumentAttachments();

  const eligibleMaintenance = useMemo(() => (allLicenses || []).filter((license) => (
    license.licenseType === "maintenance" && !isLinkedToParent(license, parentLicense.id)
  )), [allLicenses, parentLicense.id]);
  const existingMaintenanceOptions = useMemo(() => (showHidden
    ? eligibleMaintenance
    : eligibleMaintenance.filter((license) => !isHiddenFromLinking(license)))
    .slice()
    .sort((a, b) => {
      const aDate = a.endDate || "";
      const bDate = b.endDate || "";
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return (a.licenseRef || "").localeCompare(b.licenseRef || "");
    })
    .map((license) => maintenanceCandidate(license, allLicenses, { formatDay: (value) => formatDate(value, userSettings) })), [eligibleMaintenance, showHidden, allLicenses, userSettings]);

  const canSave = mode === "create"
    ? endDate.trim() !== "" && isValidNumberValue(costRaw) && !saving
    : selectedMaintenanceId !== "" && !saving;

  const isDirty = attachments.length > 0 || mode !== "create" ||
    endDate !== "" ||
    startDate !== "" ||
    costRaw !== "" ||
    poNumber !== "" ||
    contractNumber !== "" ||
    supplier !== (parentLicense.supplier || "") ||
    selectedMaintenanceId !== "";
  const handleClose = () => {
    if (saving) return;
    if (createdLicenseId != null) onSuccess(parentLicense.id);
    else onClose();
  };
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: !saving && (createdLicenseId == null ? isDirty : attachments.length > 0),
    onClose: handleClose,
  });

  const handleCreate = async () => {
    // The covered quantity is kept, so the cost is stored as quantity x unit price.
    const quantity = parentLicense.quantity || "1";

    const payload = {
      publisherName: parentLicense.publisherName,
      softwareDescription: `${parentLicense.softwareDescription} - Maintenance`,
      licenseType: "maintenance",
      licenseMetric: parentLicense.licenseMetric || "per_user",
      parentLicenseId: parentLicense.id,
      startDate: startDate || null,
      endDate,
      quantity,
      unitPrice: unitPriceFromTotal(costRaw, quantity) ?? costRaw,
      currency: parentLicense.currency || userSettings?.displayCurrency || "EUR",
      poNumber,
      contractNumber,
      supplier,
      contactEmail: parentLicense.contactEmail || "",
      budgetOwnerEmail: parentLicense.budgetOwnerEmail || "",
      costCentre: parentLicense.costCentre || "",
    };

    return createLicense(payload);
  };

  const handleSave = async (confirmed = false) => {
    if (!canSave) return;
    if (mode === "link" && !confirmed) {
      const selected = existingMaintenanceOptions.find((option) => String(option.id) === String(selectedMaintenanceId));
      const message = coversConfirmMessage(selected);
      if (message) {
        setConfirmCovers(message);
        return;
      }
    }
    setSaving(true);
    setError(null);

    try {
      let licenseId = createdLicenseId;
      if (licenseId == null) {
        const { data, error: apiError } = mode === "create"
          ? await handleCreate()
          : await linkMaintenanceToParent(parentLicense.id, Number(selectedMaintenanceId));
        if (apiError) {
          setError(apiError);
          return;
        }
        if (mode === "create") {
          licenseId = data.id;
          setCreatedLicenseId(licenseId);
        }
      }
      if (mode === "create") {
        const failures = [];
        for (const attachment of attachments) {
          try {
            const { error: uploadError } = await uploadDocument(licenseId, attachment.file, attachment.category, attachment.scope);
            if (uploadError) failures.push(`${attachment.file.name}: ${uploadError}`);
            else removeAttachment(attachment.id);
          } catch (uploadError) {
            failures.push(`${attachment.file.name}: ${uploadError.message || "Upload failed"}`);
          }
        }
        if (failures.length) {
          setError(`Maintenance record created. Retry the remaining uploads or close and review its documents. ${failures.join("; ")}`);
          return;
        }
      }
      onSuccess(parentLicense.id);
    } catch (saveError) {
      setError(saveError.message || "Could not save maintenance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ModalShell
        title="Add Maintenance Record"
        sectionControls
        titleId="dialog-title-maintenance-create"
        onClose={requestClose}
        modalStyle={{ width: 560, maxWidth: "min(560px, 92vw)" }}
        footer={(
          <>
            <button type="button" className="btn btn-g btn-sm" disabled={saving} onClick={requestClose}>{createdLicenseId != null ? "Close" : "Cancel"}</button>
            <button type="button" className="btn btn-p btn-sm" disabled={!canSave} onClick={() => handleSave()}>
              {saving
                ? "Saving..."
                : createdLicenseId != null
                  ? "Retry document uploads"
                : mode === "create"
                  ? "Create Maintenance Record"
                  : "Link Existing Record"}
            </button>
          </>
        )}
      >
        <div className="modal-bd">
          <p className="maint-modal-intro">
            Maintenance will be linked to{" "}
            <strong>{parentLicense.publisherName} - {parentLicense.softwareDescription}</strong>.
          </p>

          <div className="maint-mode-toggle" role="tablist" aria-label="Maintenance action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "create"}
              className={mode === "create" ? "active" : ""}
              onClick={() => setMode("create")}
              disabled={saving || createdLicenseId != null}
            >
              <Icon name="plus" size={12} /> Create new
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "link"}
              className={mode === "link" ? "active" : ""}
              onClick={() => setMode("link")}
              disabled={saving || createdLicenseId != null}
            >
              <Icon name="link" size={12} /> Link existing
            </button>
          </div>

          {mode === "create" ? (
            <>
              <LicenseFormSection title="Maintenance Details">
              <fieldset disabled={saving || createdLicenseId != null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="fr">
                  <div className="fg">
                    <label htmlFor="maint-start-date">Start Date</label>
                    <input
                      id="maint-start-date"
                      className="fi"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="fg">
                    <label htmlFor="maint-end-date">End Date *</label>
                    <input
                      id="maint-end-date"
                      className="fi"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="fg">
                  <label htmlFor="maint-cost">Maintenance Cost (coverage period)</label>
                  <NumberInput
                    id="maint-cost"
                    value={costRaw}
                    settings={userSettings}
                    minFractionDigits={2}
                    onChange={setCostRaw}
                    placeholder={`e.g. ${toInputText("2500.00", userSettings)}`}
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
                  <ReferenceCombobox
                    id="maint-supplier"
                    mode="supplier"
                    value={supplier}
                    onChange={setSupplier}
                  />
                </div>
              </fieldset>
              </LicenseFormSection>
              <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <DocumentStagingWorkspace
                  attachments={attachments}
                  categoryScopes={categoryScopes}
                  inputIdPrefix="maintenance-documents"
                  onAddFiles={addFiles}
                  onRemoveAttachment={removeAttachment}
                  onCategoryScopeChange={changeCategoryScope}
                  userSettings={userSettings}
                  defaultOpen
                />
              </fieldset>
            </>
          ) : (
            <div className="maint-existing-picker">
              <strong>Search Maintenance Records</strong>
              <LinkPicker
                candidates={existingMaintenanceOptions}
                selectedIds={selectedMaintenanceId ? [Number(selectedMaintenanceId)] : []}
                onChange={(ids) => setSelectedMaintenanceId(ids[0] ? String(ids[0]) : "")}
                searchPlaceholder="Search by LT ref, publisher, description, PO, contract, or date"
                listLabel="Existing maintenance records"
                emptyMessage="No eligible maintenance records match this search."
                hiddenCount={showHidden ? 0 : eligibleMaintenance.length - eligibleMaintenance.filter((license) => !isHiddenFromLinking(license)).length}
                onShowHidden={() => setShowHidden(true)}
              />
              <div className="maint-record-count">
                {existingMaintenanceOptions.length} eligible maintenance{" "}
                {existingMaintenanceOptions.length === 1 ? "record" : "records"}
              </div>
            </div>
          )}

          {error && (
            <div className="maint-modal-error">
              {error}
            </div>
          )}
        </div>
      </ModalShell>
      {confirmCovers && (
        <ConfirmDialog
          title="Cover one more license?"
          message={confirmCovers}
          confirmLabel="Also cover this license"
          onConfirm={() => { setConfirmCovers(null); handleSave(true); }}
          onCancel={() => setConfirmCovers(null)}
        />
      )}
      {showDiscardDialog && (
        <DiscardChangesDialog
          onKeep={() => setShowDiscardDialog(false)}
          onDiscard={handleClose}
        />
      )}
    </>
  );
}

import { useMemo, useState } from "react";
import { createLicense, linkMaintenanceToParent } from "../../api/licenses.js";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import Icon from "../ui/Icon.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { formatDate, parseLocalizedNumber } from "../../utils/formatting.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

function isLinkedToParent(license, parentId) {
  // parentLicenseId is retained on detached maintenance records as historical
  // provenance. Only the association list represents an active link.
  return (license.maintenanceParentIds || []).some((id) => Number(id) === Number(parentId));
}

function optionSearchText(license) {
  return [
    license.id,
    license.licenseRef,
    license.publisherName,
    license.softwareDescription,
    license.poNumber,
    license.contractNumber,
    license.startDate,
    license.endDate,
  ].filter(Boolean).join(" ").toLowerCase();
}

function MaintenanceRecordOption({ license, selected, onSelect, userSettings }) {
  return (
    <button
      type="button"
      className={`maint-record-option${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="maint-record-main">
        <span className="maint-record-ref">{license.licenseRef || `#${license.id}`}</span>
        <span className="maint-record-title">{license.publisherName} / {license.softwareDescription}</span>
      </span>
      <span className="maint-record-meta">
        <span>{license.poNumber || "No PO"}</span>
        <span>{license.contractNumber || "No contract"}</span>
        <span>
          {license.startDate ? formatDate(license.startDate, userSettings) : "-"}
          {" -> "}
          {license.endDate ? formatDate(license.endDate, userSettings) : "-"}
        </span>
      </span>
    </button>
  );
}

/**
 * Modal for creating or linking a separately tracked maintenance/support contract.
 */
export default function MaintenanceCreateModal({
  parentLicense,
  userSettings,
  allLicenses = [],
  onSuccess,
  onClose,
}) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const [mode, setMode] = useState("create");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [costRaw, setCostRaw] = useState("");
  const [costDisplay, setCostDisplay] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [supplier, setSupplier] = useState(parentLicense.supplier || "");
  const [query, setQuery] = useState("");
  const [selectedMaintenanceId, setSelectedMaintenanceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const existingMaintenanceOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (allLicenses || [])
      .filter((license) => (
        license.licenseType === "maintenance" &&
        !license.isRetired &&
        !license.retired &&
        !isLinkedToParent(license, parentLicense.id)
      ))
      .filter((license) => !q || optionSearchText(license).includes(q))
      .sort((a, b) => {
        const aDate = a.endDate || "";
        const bDate = b.endDate || "";
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return (a.licenseRef || "").localeCompare(b.licenseRef || "");
      });
  }, [allLicenses, parentLicense.id, query]);

  const canSave = mode === "create"
    ? endDate.trim() !== "" && !saving
    : selectedMaintenanceId !== "" && !saving;

  const isDirty = mode !== "create" ||
    endDate !== "" ||
    startDate !== "" ||
    costRaw !== "" ||
    poNumber !== "" ||
    contractNumber !== "" ||
    supplier !== (parentLicense.supplier || "") ||
    query !== "" ||
    selectedMaintenanceId !== "";
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  const handleCreate = async () => {
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

    return createLicense(payload);
  };

  const handleLinkExisting = () => (
    linkMaintenanceToParent(parentLicense.id, Number(selectedMaintenanceId))
  );

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const { error: apiError } = mode === "create"
      ? await handleCreate()
      : await handleLinkExisting();
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
        modalStyle={{ width: 560, maxWidth: "min(560px, 92vw)" }}
        footer={(
          <>
            <button type="button" className="btn btn-g btn-sm" onClick={requestClose}>Cancel</button>
            <button type="button" className="btn btn-p btn-sm" disabled={!canSave} onClick={handleSave}>
              {saving
                ? "Saving..."
                : mode === "create"
                  ? "Create Maintenance / Support Record"
                  : "Link Existing Record"}
            </button>
          </>
        )}
      >
        <div className="modal-bd">
          <p className="maint-modal-intro">
            Maintenance / support will be linked to{" "}
            <strong>{parentLicense.publisherName} - {parentLicense.softwareDescription}</strong>.
          </p>

          <div className="maint-mode-toggle" role="tablist" aria-label="Maintenance action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "create"}
              className={mode === "create" ? "active" : ""}
              onClick={() => setMode("create")}
            >
              <Icon name="plus" size={12} /> Create new
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "link"}
              className={mode === "link" ? "active" : ""}
              onClick={() => setMode("link")}
            >
              <Icon name="link" size={12} /> Link existing
            </button>
          </div>

          {mode === "create" ? (
            <>
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
                <label htmlFor="maint-cost">Support Cost (coverage period)</label>
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
                <ReferenceCombobox
                  id="maint-supplier"
                  mode="supplier"
                  value={supplier}
                  onChange={setSupplier}
                />
              </div>
            </>
          ) : (
            <div className="maint-existing-picker">
              <label htmlFor="maint-existing-search">Search Maintenance / Support Records</label>
              <input
                id="maint-existing-search"
                className="fi"
                type="search"
                placeholder="Search by LT ref, publisher, description, PO, contract, or date"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <div className="maint-record-list" role="listbox" aria-label="Existing maintenance records">
                {existingMaintenanceOptions.length === 0 && (
                  <div className="maint-record-empty">
                    No eligible maintenance records match this search.
                  </div>
                )}
                {existingMaintenanceOptions.map((license) => (
                  <MaintenanceRecordOption
                    key={license.id}
                    license={license}
                    selected={String(license.id) === String(selectedMaintenanceId)}
                    onSelect={() => setSelectedMaintenanceId(String(license.id))}
                    userSettings={userSettings}
                  />
                ))}
              </div>
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
      {showDiscardDialog && (
        <DiscardChangesDialog
          onKeep={() => setShowDiscardDialog(false)}
          onDiscard={onClose}
        />
      )}
    </>
  );
}

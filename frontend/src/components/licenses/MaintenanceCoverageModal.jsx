import { useMemo, useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { formatDate } from "../../utils/formatting.js";
import { maintenanceCoverageOptionsForLicenseType, supportsSeparateMaintenanceLine } from "../../utils/maintenanceCoverage.js";
import { maintenanceLinkCandidates } from "../../utils/maintenanceLinking.js";
import MaintenanceQuickLinkField from "./MaintenanceQuickLinkField.jsx";

/**
 * Edit a license's maintenance coverage. Choosing Separately tracked offers the
 * same optional quick link to an existing maintenance record as the full edit
 * form. onSave({ coverage, quickLinkId }) resolves to { error }.
 */
export default function MaintenanceCoverageModal({ license, allLicenses, userSettings, onSave, onClose }) {
  const options = maintenanceCoverageOptionsForLicenseType(license.licenseType);
  const stored = license.maintenanceCoverage || "unknown";
  const initialCoverage = options.some((option) => option.value === stored) ? stored : (options[0]?.value ?? "");
  const [coverage, setCoverage] = useState(initialCoverage);
  const [quickLinkId, setQuickLinkId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const showQuickLink = license.licenseType !== "maintenance"
    && supportsSeparateMaintenanceLine(license.licenseType)
    && coverage === "separately_tracked";
  const candidates = useMemo(
    () => (showQuickLink
      ? maintenanceLinkCandidates(allLicenses, license.id, { formatDay: (value) => formatDate(value, userSettings) })
      : []),
    [showQuickLink, allLicenses, license.id, userSettings],
  );

  const isDirty = coverage !== initialCoverage || quickLinkId !== "";
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const result = await onSave({ coverage, quickLinkId: showQuickLink ? quickLinkId : "" });
    setSaving(false);
    if (result?.error) setError(result.error);
  };

  return (
    <>
      <ModalShell
        title="Maintenance Coverage"
        titleId="dialog-title-maintenance-coverage"
        onClose={requestClose}
        modalStyle={{ width: showQuickLink ? 560 : 400, maxWidth: "92vw" }}
        footer={(
          <>
            <button type="button" className="btn btn-g btn-sm" onClick={requestClose}>Cancel</button>
            <button type="button" className="btn btn-p btn-sm" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      >
        <div className="modal-bd" style={{ paddingBottom: 8 }}>
          <div className="fg">
            <label htmlFor="maintenance-coverage-value">Maintenance Coverage</label>
            <select
              id="maintenance-coverage-value"
              className="fi fi-select"
              value={coverage}
              onChange={(event) => {
                setCoverage(event.target.value);
                if (event.target.value !== "separately_tracked") setQuickLinkId("");
              }}
              autoFocus
            >
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {showQuickLink && (
            <MaintenanceQuickLinkField candidates={candidates} value={quickLinkId} onChange={setQuickLinkId} />
          )}
          {error && <div className="field-hint" role="alert" style={{ color: "var(--red-text)" }}>{error}</div>}
        </div>
      </ModalShell>
      {showDiscardDialog && (
        <DiscardChangesDialog onKeep={() => setShowDiscardDialog(false)} onDiscard={onClose} />
      )}
    </>
  );
}

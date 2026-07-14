import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function CompletenessSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, onRefreshLicenses, onCompletenessRulesChanged, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await updateGlobalSettings({ mandatory_fields: globalSettings.mandatoryFields });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("completeness");
    if (onCompletenessRulesChanged) {
      onCompletenessRulesChanged();
    } else if (onRefreshLicenses) {
      onRefreshLicenses();
    }
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="completeness" icon="check" title="Completeness Requirements" description={"Fields required for a license to be marked \"complete\" (global)"} iconColor="var(--green)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            {Object.entries({ invoice: "Invoice attached", purchaseOrder: "Purchase Order attached", quote: "Quote attached", eula: "EULA attached", entitlement: "Proof of entitlement", startDate: "Start date", endDate: "End date / Perpetual", contractNumber: "Contract number", poNumber: "PO number", invoiceNumber: "Invoice Number", contactEmail: "Publisher contact", costCentre: "Department / Cost Centre", budgetOwnerEmail: "Budget Owner Email" }).map(([k, label]) => (
              <div className="trow" key={k}>
                <span>{label}</span>
                <Toggle value={globalSettings.mandatoryFields[k]} onChange={(v) => { setGlobalSettings(s => ({ ...s, mandatoryFields: { ...s.mandatoryFields, [k]: v } })); markDirty("completeness"); }} />
              </div>
            ))}
            <SectionSaveButton sectionKey="completeness" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function RenewalsSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const threshold = Number(globalSettings.highValueThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      onError("High-value threshold must be a non-negative number.");
      return;
    }
    const actionDays = Number(globalSettings.renewalActionDays ?? globalSettings.notificationDays ?? 30);
    if (!Number.isInteger(actionDays) || actionDays < 0 || actionDays > 365) {
      onError("Renewal action days must be a whole number from 0 to 365.");
      return;
    }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      high_value_threshold: threshold,
      fiscal_year_start_month: globalSettings.fiscalYearStartMonth ?? 1,
      renewal_action_days: actionDays,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("renewals");
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="renewals" icon="refresh" title="Renewals" description="Renewal workbench configuration (global)" iconColor="var(--purple)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div className="set-section-stack">
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-renewal-action-days">Allow renewal actions X days before expiry</label>
                <p className="set-field-hint">
                  Controls when procurement initiation and existing-successor linking become available. Expiration badges and notifications are unchanged.
                </p>
                <input
                  id="settings-renewal-action-days"
                  className="fi"
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  value={globalSettings.renewalActionDays ?? globalSettings.notificationDays ?? 30}
                  onChange={(e) => {
                    setGlobalSettings(s => ({ ...s, renewalActionDays: e.target.value }));
                    markDirty("renewals");
                  }}
                />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-high-value-threshold">High-Value Threshold</label>
                <p className="set-field-hint">
                  Licenses with an estimated annual value at or above this amount are flagged as high-value in the Renewal Workbench.
                </p>
                <input
                  id="settings-high-value-threshold"
                  className="fi"
                  type="number"
                  min="0"
                  step="1000"
                  value={globalSettings.highValueThreshold ?? 50000}
                  onChange={(e) => {
                    setGlobalSettings(s => ({ ...s, highValueThreshold: parseFloat(e.target.value) || 0 }));
                    markDirty("renewals");
                  }}
                />
              </div>
            </div>
            <div className="fr set-form-row-spaced">
              <div className="fg">
                <label htmlFor="settings-fiscal-year-start-month">Fiscal Year Start Month</label>
                <p className="set-field-hint">
                  Quarter labels in the renewal calendar align to this month. January = calendar quarters.
                </p>
                <select
                  id="settings-fiscal-year-start-month"
                  className="fi"
                  value={globalSettings.fiscalYearStartMonth ?? 1}
                  onChange={(e) => {
                    setGlobalSettings(s => ({ ...s, fiscalYearStartMonth: Number(e.target.value) }));
                    markDirty("renewals");
                  }}
                >
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((name, idx) => (
                    <option key={idx + 1} value={idx + 1}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
            <SectionSaveButton sectionKey="renewals" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

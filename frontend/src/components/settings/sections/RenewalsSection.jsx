import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { mapResponseToState } from "../../../utils/settingsHelpers.js";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function RenewalsSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const threshold = Number(globalSettings.highValueThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      onError("High-value threshold must be a non-negative number.");
      return;
    }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      high_value_threshold: threshold,
      fiscal_year_start_month: globalSettings.fiscalYearStartMonth ?? 1,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => ({ ...s, ...mapResponseToState(data, s) }));
    navGuard?.sectionSaved?.({ global: mapResponseToState(data, globalSettings) });
    clearDirty("renewals");
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="renewals" icon="refresh" title="Renewals" description="Renewal workbench configuration (global)" iconColor="var(--purple)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-high-value-threshold">High-Value Threshold</label>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 8px" }}>
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
            <div className="fr" style={{ marginTop: 16 }}>
              <div className="fg">
                <label htmlFor="settings-fiscal-year-start-month">Fiscal Year Start Month</label>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 8px" }}>
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

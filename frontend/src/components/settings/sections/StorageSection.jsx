import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function StorageSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await updateGlobalSettings({ storage_path: globalSettings.storagePath });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("storage");
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="storage" icon="folder" title="Document Storage" description="File system path where uploaded documents are stored (admin only)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div className="set-section-stack">
            <div className="fr">
              <div className="fg set-flex-fill">
                <label htmlFor="settings-storage-path">Storage Path</label>
                <input id="settings-storage-path" className="fi" value={globalSettings.storagePath} onChange={(e) => { setGlobalSettings(s => ({ ...s, storagePath: e.target.value })); markDirty("storage"); }} placeholder="e.g. /data/licenses/documents" />
              </div>
            </div>
            <p className="set-small-hint">
              Leave empty to use the default server path. Changing this does NOT move existing files - move them manually first, then update this path.
            </p>
            <SectionSaveButton sectionKey="storage" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

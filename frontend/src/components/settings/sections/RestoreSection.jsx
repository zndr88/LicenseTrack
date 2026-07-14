import { useState } from "react";
import { restoreBackup } from "../../../api/settings.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

export default function RestoreSection({ isOpen, isDirty, onToggle, onError, onToast }) {
  const [restoreFile, setRestoreFile] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    if (!restoreFile) return;
    setShowRestoreConfirm(false);
    setRestoring(true);
    const { data, error } = await restoreBackup(restoreFile);
    setRestoring(false);
    if (error) { onError(error); return; }
    onToast(
      data?.restart_scheduled
        ? "Database restore initiated - the server is restarting..."
        : "Database restore completed.",
      "info"
    );
    setRestoreFile(null);
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="restore" icon="upload" title="Restore Database" description="Restore from a database backup zip file - overwrites current database rows (admin only)" iconColor="var(--red)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div className="set-section-stack">
              <div className="set-danger-box">
                <p className="set-danger-text">
                  <strong>Warning:</strong> Restoring will permanently overwrite the current database. Uploaded document files are not restored by this action and remain the operator's storage responsibility. A safety snapshot is created automatically before the restore. The backend may restart after the restore completes, depending on server configuration.
                </p>
              </div>
              <div className="fr">
                <div className="fg set-flex-fill">
                  <label htmlFor="settings-backup-file">Database Backup File (.zip)</label>
                  <input id="settings-backup-file" className="set-file-input" type="file" accept=".zip" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
              <div className="set-form-actions">
                <button className="btn set-danger-button" disabled={!restoreFile || restoring} onClick={() => setShowRestoreConfirm(true)}>
                  <Icon name="upload" size={14} /> {restoring ? "Restoring..." : "Restore Database"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showRestoreConfirm && (
        <ConfirmDialog title="Restore Database" message={`Restore the database from "${restoreFile?.name}"? The current database will be overwritten. Uploaded document files are not included in database restore. This cannot be undone.`} confirmLabel="Restore Database" danger onConfirm={handleRestore} onCancel={() => setShowRestoreConfirm(false)} />
      )}
    </>
  );
}

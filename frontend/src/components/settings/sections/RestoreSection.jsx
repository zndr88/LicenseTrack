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
            <div style={{ marginTop: 12 }}>
              <div style={{ padding: "10px 14px", background: "var(--red-m)", border: "1px solid var(--red)", borderRadius: "var(--r)", marginBottom: 14 }}>
                <p style={{ fontSize: 12, color: "var(--red-text)", margin: 0 }}>
                  <strong>Warning:</strong> Restoring will permanently overwrite the current database. Uploaded document files are not restored by this action and remain the operator's storage responsibility. A safety snapshot is created automatically before the restore. The backend may restart after the restore completes, depending on server configuration.
                </p>
              </div>
              <div className="fr">
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor="settings-backup-file">Database Backup File (.zip)</label>
                  <input id="settings-backup-file" type="file" accept=".zip" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} style={{ display: "block", marginTop: 6 }} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn" style={{ background: "var(--red)", color: "var(--bg-0)", fontSize: 13, opacity: (!restoreFile || restoring) ? 0.6 : 1 }} disabled={!restoreFile || restoring} onClick={() => setShowRestoreConfirm(true)}>
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

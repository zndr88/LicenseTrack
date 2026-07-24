import { useEffect, useMemo, useState } from "react";
import {
  listBackups,
  restoreBackup,
  restoreServerBackup,
} from "../../../api/settings.js";
import { formatDateTime, formatFileSize } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

function archiveTypeLabel(archive) {
  if (archive?.archive_type === "portfolio_reset_recovery") return "Portfolio recovery";
  if (archive?.archive_type === "document_restore_safety") return "Pre-restore safety";
  return "Database backup";
}

export default function RestoreSection({
  isOpen,
  isDirty,
  onToggle,
  onError,
  onToast,
  userSettings,
}) {
  const [restoreFile, setRestoreFile] = useState(null);
  const [serverBackups, setServerBackups] = useState([]);
  const [selectedFilename, setSelectedFilename] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingBackups(true);
    listBackups().then(({ data, error }) => {
      setLoadingBackups(false);
      if (error) {
        onError(error);
        return;
      }
      const archives = data || [];
      setServerBackups(archives);
      setSelectedFilename((current) => (
        archives.some((archive) => archive.filename === current)
          ? current
          : archives[0]?.filename || ""
      ));
    });
  }, [isOpen, onError]);

  const selectedArchive = useMemo(
    () => serverBackups.find((archive) => archive.filename === selectedFilename) || null,
    [selectedFilename, serverBackups],
  );

  const handleRestore = async () => {
    if (!pendingRestore) return;
    const restoreTarget = pendingRestore;
    setPendingRestore(null);
    setRestoring(true);
    const { data, error } = restoreTarget.source === "server"
      ? await restoreServerBackup(restoreTarget.archive.filename)
      : await restoreBackup(restoreTarget.file);
    setRestoring(false);
    if (error) {
      onError(error);
      return;
    }
    const restoredDocuments = data?.restored_documents;
    const action = restoredDocuments ? "Database and document restore" : "Database restore";
    onToast(
      data?.restart_scheduled
        ? `${action} initiated - the server is restarting and may be unavailable for about 10 seconds.`
        : `${action} completed.`,
      "info",
    );
    if (restoreTarget.source === "upload") setRestoreFile(null);
  };

  const confirmationMessage = pendingRestore?.source === "server"
    ? pendingRestore.archive.includes_documents
      ? `Restore the database and managed documents from "${pendingRestore.archive.filename}"? Current database rows and managed document folders will be overwritten. A database-and-document safety archive is created first. This cannot be undone without another restore.`
      : `Restore the database from "${pendingRestore.archive.filename}"? Current database rows will be overwritten. Managed document files remain unchanged. A database safety snapshot is created first.`
    : `Restore from the uploaded file "${pendingRestore?.file?.name}"? Routine backups overwrite database rows only. Portfolio recovery archives overwrite both database rows and managed documents. A matching safety snapshot is created first.`;

  return (
    <>
      <div className="setsec">
        <SectionHeader
          sectionKey="restore"
          icon="upload"
          title="Restore Database"
          description="Restore a server archive or upload a backup file (admin only)"
          iconColor="var(--red)"
          isOpen={isOpen}
          isDirty={isDirty}
          onToggle={onToggle}
        />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div className="set-section-stack">
              <div className="set-danger-box">
                <p className="set-danger-text">
                  <strong>Warning:</strong> A database backup overwrites database rows but leaves
                  documents unchanged. A portfolio recovery or pre-restore safety archive overwrites
                  both the database and managed document folders. LicenseTrack creates a matching
                  safety snapshot before either restore and may restart afterward.
                </p>
              </div>

              <div className="set-restore-source">
                <div className="set-restore-source-heading">
                  <div>
                    <strong>Restore from this server</strong>
                    <span>Select an archive stored in the configured backup location.</span>
                  </div>
                  <Icon name="server" size={16} />
                </div>
                {loadingBackups ? (
                  <p className="set-muted-text">Loading server archives...</p>
                ) : serverBackups.length > 0 ? (
                  <>
                    <div className="fg">
                      <label htmlFor="settings-server-backup">Server Archive</label>
                      <select
                        id="settings-server-backup"
                        className="fi"
                        value={selectedFilename}
                        disabled={restoring}
                        onChange={(event) => setSelectedFilename(event.target.value)}
                      >
                        {serverBackups.map((archive) => (
                          <option key={archive.filename} value={archive.filename}>
                            {archiveTypeLabel(archive)} — {archive.filename}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedArchive && (
                      <div className="set-restore-archive-meta">
                        <span>{archiveTypeLabel(selectedArchive)}</span>
                        <span>{formatFileSize(selectedArchive.size_bytes, userSettings)}</span>
                        <span>
                          {formatDateTime(
                            new Date(selectedArchive.created_at * 1000).toISOString(),
                            userSettings,
                          )}
                        </span>
                      </div>
                    )}
                    <div className="set-form-actions">
                      <button
                        type="button"
                        className="btn set-danger-button"
                        disabled={!selectedArchive || restoring}
                        onClick={() => setPendingRestore({ source: "server", archive: selectedArchive })}
                      >
                        <Icon name="upload" size={14} />
                        {restoring ? "Restoring..." : "Restore Selected Archive"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="set-muted-text">
                    No restorable archives are available in the configured server backup location.
                  </p>
                )}
              </div>

              <div className="set-restore-divider"><span>or upload an archive</span></div>

              <div className="set-restore-source set-restore-source-upload">
                <div className="set-restore-source-heading">
                  <div>
                    <strong>Upload from this computer</strong>
                    <span>Use an off-host backup or recovery archive.</span>
                  </div>
                  <Icon name="upload" size={16} />
                </div>
                <div className="fg">
                  <label htmlFor="settings-backup-file">Backup File (.zip)</label>
                  <input
                    id="settings-backup-file"
                    className="set-file-input"
                    type="file"
                    accept=".zip"
                    disabled={restoring}
                    onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="set-form-actions">
                  <button
                    type="button"
                    className="btn set-danger-button"
                    disabled={!restoreFile || restoring}
                    onClick={() => setPendingRestore({ source: "upload", file: restoreFile })}
                  >
                    <Icon name="upload" size={14} />
                    {restoring ? "Restoring..." : "Restore Uploaded Archive"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {pendingRestore && (
        <ConfirmDialog
          title={pendingRestore.source === "server" ? "Restore Server Archive" : "Restore Uploaded Archive"}
          message={confirmationMessage}
          confirmLabel="Restore Archive"
          danger
          onConfirm={handleRestore}
          onCancel={() => setPendingRestore(null)}
        />
      )}
    </>
  );
}

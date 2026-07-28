import { useState, useEffect } from "react";
import { updateGlobalSettings, triggerBackup, listBackups } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { backupSaveSchema } from "../../../utils/settingsSchemas.js";
import { formatDateTime, formatFileSize } from "../../../utils/formatting.js";
import { parseIntegerInput } from "../../../utils/validation.js";
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

function archiveTypeLabel(archive) {
  if (archive.archive_type === "portfolio_reset_recovery") return "Portfolio recovery";
  if (archive.archive_type === "document_restore_safety") return "Pre-restore safety";
  return "Database";
}

export default function BackupSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard, userSettings }) {
  const [saving, setSaving] = useState(false);
  const [backupList, setBackupList] = useState([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [backupTriggering, setBackupTriggering] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setBackupListLoading(true);
    listBackups().then(({ data, error }) => {
      setBackupListLoading(false);
      if (!error && data) setBackupList(data);
    });
  }, [isOpen]);

  const handleSave = async () => {
    const validation = backupSaveSchema.safeParse({
      backupHour: globalSettings.backupHour,
      backupKeep: globalSettings.backupKeep,
      auditLogRetentionDays: globalSettings.auditLogRetentionDays ?? 90,
    });
    if (!validation.success) { onError(validation.error.issues[0].message); return; }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      backup_location: globalSettings.backupLocation,
      backup_enabled: globalSettings.backupEnabled,
      backup_hour: globalSettings.backupHour,
      backup_keep: globalSettings.backupKeep,
      audit_log_retention_days: globalSettings.auditLogRetentionDays ?? 90,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("backup");
    onToast("Settings saved.", "info");
  };

  const handleTriggerBackup = async () => {
    setBackupTriggering(true);
    const { data, error } = await triggerBackup();
    setBackupTriggering(false);
    if (error) { onError(error); return; }
    onToast(`Database backup created: ${data.filename}`, "success");
    const { data: list } = await listBackups();
    if (list) setBackupList(list);
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="backup" icon="server" title="Database Backup" description="Scheduled and manual database backups (admin only)" iconColor="var(--accent)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div className="set-section-stack">
            <div className="set-warning-box">
              <Icon name="alert" size={14} color="var(--orange)" className="set-warning-icon" />
              <span className="set-warning-text">
                <strong>Database backup only.</strong>{" "}
                This backup covers the database file. Uploaded document files stored on disk are <em>not</em> included
                and must be backed up separately. Check the storage path configured under Storage settings.
              </span>
            </div>
            <div className="fr">
              <div className="fg set-flex-field">
                <label htmlFor="settings-backup-location">Database Backup Location</label>
                <input id="settings-backup-location" className="fi" value={globalSettings.backupLocation} onChange={(e) => { setGlobalSettings(s => ({ ...s, backupLocation: e.target.value })); markDirty("backup"); }} placeholder="./backups" />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-backup-hour">Daily Database Backup Hour (0-23)</label>
                <input id="settings-backup-hour" className="fi" type="number" min="0" max="23" value={globalSettings.backupHour} onChange={(e) => { setGlobalSettings(s => ({ ...s, backupHour: parseIntegerInput(e.target.value) })); markDirty("backup"); }} />
              </div>
              <div className="fg">
                <label htmlFor="settings-backup-keep">Keep (number of database backups)</label>
                <input id="settings-backup-keep" className="fi" type="number" min="1" max="100" value={globalSettings.backupKeep} onChange={(e) => { setGlobalSettings(s => ({ ...s, backupKeep: parseInt(e.target.value) || 10 })); markDirty("backup"); }} />
              </div>
              <div className="fg">
                <label htmlFor="settings-audit-retention">Audit log retention</label>
                <select id="settings-audit-retention" className="fi" value={globalSettings.auditLogRetentionDays ?? 90} onChange={(e) => { setGlobalSettings(s => ({ ...s, auditLogRetentionDays: parseInt(e.target.value) })); markDirty("backup"); }}>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                </select>
              </div>
            </div>
            <div className="trow">
              <span>Scheduled Daily Database Backup</span>
              <Toggle value={globalSettings.backupEnabled} onChange={(v) => { setGlobalSettings(s => ({ ...s, backupEnabled: v })); markDirty("backup"); }} />
            </div>
            <div className="set-inline-actions">
              <button className="btn btn-g" onClick={handleTriggerBackup} disabled={backupTriggering}>
                <Icon name="download" size={14} /> {backupTriggering ? "Creating..." : "Create Database Backup"}
              </button>
              <span className="set-inline-warning">
                <Icon name="alert" size={11} color="var(--orange)" />
                Database only - document files are not included
              </span>
            </div>
            {globalSettings.lastBackupStatus && (
              <div className={`set-status-box ${globalSettings.lastBackupStatus === "failed" ? "set-status-box-failed" : "set-status-box-success"}`}>
                {globalSettings.lastBackupStatus === "failed" ? "Last scheduled database backup failed." : "Last scheduled database backup succeeded."}
                {globalSettings.lastBackupAt && <span className="set-status-time">{formatDateTime(globalSettings.lastBackupAt, userSettings)}</span>}
              </div>
            )}
            <SectionSaveButton sectionKey="backup" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
            {backupListLoading ? (
              <p className="set-muted-text">Loading database backups...</p>
            ) : backupList.length > 0 ? (
              <div className="set-backup-list">
                <p className="set-backup-title">Available Server Archives</p>
                <table className="set-backup-table">
                  <thead>
                    <tr>
                      <th scope="col">Filename</th>
                      <th scope="col">Type</th>
                      <th scope="col">Size</th>
                      <th scope="col">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupList.map((b) => (
                      <tr key={b.filename}>
                        <td className="set-backup-filename">{b.filename}</td>
                        <td>{archiveTypeLabel(b)}</td>
                        <td>{formatFileSize(b.size_bytes, userSettings)}</td>
                        <td>{formatDateTime(new Date(b.created_at * 1000).toISOString(), userSettings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="set-muted-text">No restorable server archives found in the configured location.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

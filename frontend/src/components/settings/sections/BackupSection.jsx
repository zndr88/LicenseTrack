import { useState, useEffect } from "react";
import { updateGlobalSettings, triggerBackup, listBackups } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { backupSaveSchema } from "../../../utils/settingsSchemas.js";
import { formatDateTime, formatFileSize } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

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
          <div style={{ marginTop: 12 }}>
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px",
              background: "var(--orange-m, rgba(234,179,8,.12))", border: "1px solid var(--orange, #ca8a04)",
              borderRadius: "var(--r)", marginBottom: 12,
            }}>
              <Icon name="alert" size={14} color="var(--orange, #ca8a04)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
                <strong style={{ color: "var(--text)" }}>Database backup only.</strong>{" "}
                This backup covers the database file. Uploaded document files stored on disk are <em>not</em> included
                and must be backed up separately. Check the storage path configured under Storage settings.
              </span>
            </div>
            <div className="fr">
              <div className="fg" style={{ flex: 1 }}>
                <label htmlFor="settings-backup-location">Database Backup Location</label>
                <input id="settings-backup-location" className="fi" value={globalSettings.backupLocation} onChange={(e) => { setGlobalSettings(s => ({ ...s, backupLocation: e.target.value })); markDirty("backup"); }} placeholder="./backups" />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-backup-hour">Daily Database Backup Hour (0–23)</label>
                <input id="settings-backup-hour" className="fi" type="number" min="0" max="23" value={globalSettings.backupHour} onChange={(e) => { setGlobalSettings(s => ({ ...s, backupHour: parseInt(e.target.value) || 2 })); markDirty("backup"); }} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn btn-g" onClick={handleTriggerBackup} disabled={backupTriggering}>
                <Icon name="download" size={14} /> {backupTriggering ? "Creating..." : "Create Database Backup"}
              </button>
              <span style={{ fontSize: 11, color: "var(--orange, #ca8a04)", display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="alert" size={11} color="var(--orange, #ca8a04)" />
                Database only — document files are not included
              </span>
            </div>
            {globalSettings.lastBackupStatus && (
              <div style={{ marginTop: 10, padding: "7px 12px", borderRadius: "var(--r)", fontSize: 12, background: globalSettings.lastBackupStatus === "failed" ? "var(--red-m)" : "var(--green-m)", border: `1px solid ${globalSettings.lastBackupStatus === "failed" ? "var(--red)" : "var(--green)"}`, color: globalSettings.lastBackupStatus === "failed" ? "var(--red-text)" : "var(--green-text)" }}>
                {globalSettings.lastBackupStatus === "failed" ? "Last scheduled database backup failed." : "Last scheduled database backup succeeded."}
                {globalSettings.lastBackupAt && <span style={{ marginLeft: 6, opacity: 0.75 }}>{formatDateTime(globalSettings.lastBackupAt, userSettings)}</span>}
              </div>
            )}
            <SectionSaveButton sectionKey="backup" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
            {backupListLoading ? (
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>Loading database backups...</p>
            ) : backupList.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Recent Database Backups</p>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                      <th scope="col" style={{ paddingBottom: 4 }}>Filename</th>
                      <th scope="col" style={{ paddingBottom: 4 }}>Size</th>
                      <th scope="col" style={{ paddingBottom: 4 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupList.map((b) => (
                      <tr key={b.filename}>
                        <td style={{ padding: "3px 0", color: "var(--text)" }}>{b.filename}</td>
                        <td style={{ padding: "3px 0", color: "var(--text-2)" }}>{formatFileSize(b.size_bytes, userSettings)}</td>
                        <td style={{ padding: "3px 0", color: "var(--text-2)" }}>{formatDateTime(new Date(b.created_at * 1000).toISOString(), userSettings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>No database backups found in the configured location.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

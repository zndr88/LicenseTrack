import { useState } from "react";
import { updateGlobalSettings } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { allowedEmailDomain } from "../../../utils/validation.js";
import { notificationsSaveSchema } from "../../../utils/settingsSchemas.js";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function NotificationsSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);
  const [domainInput, setDomainInput] = useState("");

  const handleSave = async () => {
    const validation = notificationsSaveSchema.safeParse({
      managerEmail: globalSettings.managerEmail,
      notificationSendHour: globalSettings.notificationSendHour,
      notificationDays: globalSettings.notificationDays ?? 30,
      noticeNotificationDays: globalSettings.noticeNotificationDays ?? 30,
    });
    if (!validation.success) { onError(validation.error.issues[0].message); return; }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      notification_days: globalSettings.notificationDays,
      notice_notification_days: globalSettings.noticeNotificationDays ?? 30,
      manager_email: globalSettings.managerEmail,
      notification_send_hour: globalSettings.notificationSendHour,
      allowed_email_domains: globalSettings.allowedEmailDomains.join(","),
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("notifications");
    onToast("Settings saved.", "info");
  };

  const addDomain = () => {
    const domainErr = allowedEmailDomain(domainInput);
    if (domainErr) { onError(domainErr); return; }
    let val = domainInput.trim().toLowerCase();
    if (val.startsWith("@")) val = val.slice(1);
    if (globalSettings.allowedEmailDomains.includes(val)) { setDomainInput(""); return; }
    setGlobalSettings(s => ({ ...s, allowedEmailDomains: [...s.allowedEmailDomains, val] }));
    setDomainInput("");
    markDirty("notifications");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="notifications" icon="bell" title="Notifications" description="Alert windows and report recipients (global)" iconColor="var(--orange)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div className="set-section-stack">
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-alert-window">Expiration Alert Window (days)</label>
                <input id="settings-alert-window" className="fi" type="number" value={globalSettings.notificationDays} onChange={(e) => { setGlobalSettings(s => ({ ...s, notificationDays: parseInt(e.target.value) || 30 })); markDirty("notifications"); }} />
              </div>
      <div className="fg">
                <label htmlFor="settings-notice-alert-window">Notice Deadline Lead Time (days)</label>
                <input id="settings-notice-alert-window" className="fi" type="number" value={globalSettings.noticeNotificationDays ?? 30} onChange={(e) => { setGlobalSettings(s => ({ ...s, noticeNotificationDays: parseInt(e.target.value) || 30 })); markDirty("notifications"); }} />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-manager-email">Manager Email</label>
                <input id="settings-manager-email" className="fi" value={globalSettings.managerEmail} onChange={(e) => { setGlobalSettings(s => ({ ...s, managerEmail: e.target.value })); markDirty("notifications"); }} />
              </div>
              <div className="fg">
                <label htmlFor="settings-send-hour">Daily Send Time (hour, 0-23)</label>
                <input id="settings-send-hour" className="fi" type="number" min="0" max="23" value={globalSettings.notificationSendHour} onChange={(e) => { setGlobalSettings(s => ({ ...s, notificationSendHour: parseInt(e.target.value) || 7 })); markDirty("notifications"); }} />
              </div>
            </div>
            <div className="fg set-spaced-field">
              <label htmlFor="settings-allowed-domains">Allowed Outbound Domains</label>
              <p className="set-field-hint">Only these domains can receive notification emails. Leave empty to allow all domains.</p>
              {globalSettings.allowedEmailDomains.length > 0 && (
                <div className="set-domain-list">
                  {globalSettings.allowedEmailDomains.map((d) => (
                    <span key={d} className="set-domain-chip">
                      {d}
                      <button type="button" className="set-domain-remove" onClick={() => { setGlobalSettings(s => ({ ...s, allowedEmailDomains: s.allowedEmailDomains.filter(x => x !== d) })); markDirty("notifications"); }} title={`Remove ${d}`}>&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="set-inline-control">
                <input id="settings-allowed-domains" className="fi set-inline-input" value={domainInput} placeholder="example.com" onChange={(e) => setDomainInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDomain(); } }} />
                <button className="btn btn-g set-add-button" onClick={addDomain}>Add</button>
              </div>
            </div>
            <SectionSaveButton sectionKey="notifications" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

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
    });
    if (!validation.success) { onError(validation.error.issues[0].message); return; }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      notification_days: globalSettings.notificationDays,
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
      <SectionHeader sectionKey="notifications" icon="bell" title="Notifications" description="Expiration alert configuration (global)" iconColor="var(--orange)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-alert-window">Alert Window (days)</label>
                <input id="settings-alert-window" className="fi" type="number" value={globalSettings.notificationDays} onChange={(e) => { setGlobalSettings(s => ({ ...s, notificationDays: parseInt(e.target.value) || 30 })); markDirty("notifications"); }} />
              </div>
              <div className="fg">
                <label htmlFor="settings-manager-email">Manager Email</label>
                <input id="settings-manager-email" className="fi" value={globalSettings.managerEmail} onChange={(e) => { setGlobalSettings(s => ({ ...s, managerEmail: e.target.value })); markDirty("notifications"); }} />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-send-hour">Daily Send Time (hour, 0–23)</label>
                <input id="settings-send-hour" className="fi" type="number" min="0" max="23" value={globalSettings.notificationSendHour} onChange={(e) => { setGlobalSettings(s => ({ ...s, notificationSendHour: parseInt(e.target.value) || 7 })); markDirty("notifications"); }} />
              </div>
            </div>
            <div className="fg" style={{ marginTop: 8 }}>
              <label htmlFor="settings-allowed-domains">Allowed Outbound Domains</label>
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 8px" }}>Only these domains can receive notification emails. Leave empty to allow all domains.</p>
              {globalSettings.allowedEmailDomains.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {globalSettings.allowedEmailDomains.map((d) => (
                    <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text)" }}>
                      {d}
                      <button onClick={() => { setGlobalSettings(s => ({ ...s, allowedEmailDomains: s.allowedEmailDomains.filter(x => x !== d) })); markDirty("notifications"); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--red)", fontSize: 13, marginLeft: 2 }} title={`Remove ${d}`}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <input id="settings-allowed-domains" className="fi" style={{ flex: 1 }} value={domainInput} placeholder="e.g. company.com" onChange={(e) => setDomainInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDomain(); } }} />
                <button className="btn btn-g" style={{ padding: "0 12px", fontSize: 12 }} onClick={addDomain}>Add</button>
              </div>
            </div>
            <SectionSaveButton sectionKey="notifications" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback } from "react";
import { updateGlobalSettings, sendTestEmail, triggerNotifications } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { smtpSaveSchema, smtpConnectionSchema } from "../../../utils/settingsSchemas.js";
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import EmailTemplatesModal from "../EmailTemplatesModal.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

export default function SmtpSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard }) {
  const [saving, setSaving] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [triggeringSending, setTriggeringSending] = useState(false);
  const [emailTemplatesOpen, setEmailTemplatesOpen] = useState(false);
  const [emailTemplateDraft, setEmailTemplateDraft] = useState({ emailTemplateBudgetOwnerIntro: "", emailTemplateBudgetOwnerSignoff: "", emailTemplateManagerIntro: "" });
  const [emailTemplatesSaving, setEmailTemplatesSaving] = useState(false);
  const unsavedSettingsMessage = "Save email settings before testing or sending notifications.";

  const handleSave = async () => {
    const schema = globalSettings.emailEnabled ? smtpConnectionSchema : smtpSaveSchema;
    const validation = schema.safeParse({
      smtpHost: globalSettings.smtpHost,
      smtpPort: globalSettings.smtpPort,
      smtpSender: globalSettings.smtpSender,
    });
    if (!validation.success) { onError(validation.error.issues[0].message); return; }
    setSaving(true);
    const { data, error } = await updateGlobalSettings({
      email_enabled: globalSettings.emailEnabled,
      smtp_host: globalSettings.smtpHost,
      smtp_port: globalSettings.smtpPort,
      smtp_username: globalSettings.smtpUsername,
      smtp_password: globalSettings.smtpPassword,
      smtp_sender: globalSettings.smtpSender,
      smtp_use_tls: globalSettings.smtpUseTls,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    navGuard?.sectionSaved?.({ global: normalizeGlobalSettings(data, globalSettings) });
    clearDirty("smtp");
    onToast("Settings saved.", "info");
  };

  const handleTestEmail = async () => {
    if (isDirty) { onError(unsavedSettingsMessage); return; }
    const validation = smtpConnectionSchema.safeParse({
      smtpHost: globalSettings.smtpHost,
      smtpPort: globalSettings.smtpPort,
      smtpSender: globalSettings.smtpSender,
    });
    if (!validation.success) { onError(validation.error.issues[0].message); return; }
    setTestEmailSending(true);
    const { error } = await sendTestEmail();
    setTestEmailSending(false);
    if (error) { onError(error); return; }
    onToast("Test email sent to " + globalSettings.managerEmail, "success");
  };

  const handleTriggerNotifications = async () => {
    if (isDirty) { onError(unsavedSettingsMessage); return; }
    setTriggeringSending(true);
    const { data, error } = await triggerNotifications();
    setTriggeringSending(false);
    if (error) { onError(error); return; }
    const msg = data
      ? `Sent ${data.budget_owner_emails_sent} owner email(s), digest ${data.digest_sent ? "sent" : "skipped"}. ${data.errors?.length || 0} error(s).`
      : "Notifications triggered.";
    onToast(msg, data?.errors?.length ? "error" : "success");
  };

  const handleOpenEmailTemplates = useCallback(() => {
    setEmailTemplateDraft({
      emailTemplateBudgetOwnerIntro: globalSettings.emailTemplateBudgetOwnerIntro ?? "",
      emailTemplateBudgetOwnerSignoff: globalSettings.emailTemplateBudgetOwnerSignoff ?? "",
      emailTemplateManagerIntro: globalSettings.emailTemplateManagerIntro ?? "",
    });
    setEmailTemplatesOpen(true);
  }, [globalSettings.emailTemplateBudgetOwnerIntro, globalSettings.emailTemplateBudgetOwnerSignoff, globalSettings.emailTemplateManagerIntro]);

  const handleSaveEmailTemplates = async () => {
    setEmailTemplatesSaving(true);
    const { data, error } = await updateGlobalSettings({
      email_template_budget_owner_intro: emailTemplateDraft.emailTemplateBudgetOwnerIntro,
      email_template_budget_owner_signoff: emailTemplateDraft.emailTemplateBudgetOwnerSignoff,
      email_template_manager_intro: emailTemplateDraft.emailTemplateManagerIntro,
    });
    setEmailTemplatesSaving(false);
    if (error) { onError(error); return; }
    setGlobalSettings(s => normalizeGlobalSettings(data, s));
    setEmailTemplatesOpen(false);
    onToast("Email templates saved.", "success");
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="smtp" icon="mail" title="Email Configuration" description="SMTP server settings for automated email notifications (global)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div style={{ marginTop: 12 }}>
              <div className="trow" style={{ marginBottom: 14 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>Enable Email Notifications</span>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>When off, no automated or manual notification emails will be sent. SMTP settings can still be configured while disabled.</div>
                </div>
                <Toggle value={globalSettings.emailEnabled ?? false} onChange={v => { setGlobalSettings(s => ({ ...s, emailEnabled: v })); markDirty("smtp"); }} />
              </div>
              <div className="fr">
                <div className="fg" style={{ flex: 2 }}>
                  <label htmlFor="settings-smtp-host">SMTP Host</label>
                  <input id="settings-smtp-host" className="fi" value={globalSettings.smtpHost} onChange={e => { setGlobalSettings(s => ({ ...s, smtpHost: e.target.value })); markDirty("smtp"); }} placeholder="smtp.example.com" />
                </div>
                <div className="fg" style={{ flex: 1 }}>
                  <label htmlFor="settings-smtp-port">Port</label>
                  <input id="settings-smtp-port" className="fi" type="number" value={globalSettings.smtpPort} onChange={e => { setGlobalSettings(s => ({ ...s, smtpPort: parseInt(e.target.value) || 587 })); markDirty("smtp"); }} />
                </div>
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor="settings-smtp-username">Username</label>
                  <input id="settings-smtp-username" className="fi" value={globalSettings.smtpUsername} onChange={e => { setGlobalSettings(s => ({ ...s, smtpUsername: e.target.value })); markDirty("smtp"); }} placeholder="notifications@example.com" />
                </div>
                <div className="fg">
                  <label htmlFor="settings-smtp-password">Password</label>
                  <input id="settings-smtp-password" className="fi" type="password" autoComplete="off" value={globalSettings.smtpPassword} onChange={e => { setGlobalSettings(s => ({ ...s, smtpPassword: e.target.value })); markDirty("smtp"); }} placeholder="••••••••" />
                </div>
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor="settings-smtp-sender">Sender Address</label>
                  <input id="settings-smtp-sender" className="fi" value={globalSettings.smtpSender} onChange={e => { setGlobalSettings(s => ({ ...s, smtpSender: e.target.value })); markDirty("smtp"); }} placeholder="LicenseTrack <noreply@example.com>" />
                </div>
              </div>
              <div className="trow">
                <span>Use TLS</span>
                <Toggle value={globalSettings.smtpUseTls} onChange={v => { setGlobalSettings(s => ({ ...s, smtpUseTls: v })); markDirty("smtp"); }} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-g" onClick={handleTestEmail} disabled={testEmailSending || isDirty} title={isDirty ? unsavedSettingsMessage : undefined}>
                  <Icon name="mail" size={14} /> {testEmailSending ? "Sending..." : "Send Test Email"}
                </button>
                <button className="btn btn-g" onClick={handleTriggerNotifications} disabled={triggeringSending || !globalSettings.emailEnabled || isDirty} title={isDirty ? unsavedSettingsMessage : !globalSettings.emailEnabled ? "Enable email notifications to use this feature" : undefined}>
                  <Icon name="bell" size={14} /> {triggeringSending ? "Sending..." : "Send Notifications Now"}
                </button>
                <button type="button" className="btn btn-g" onClick={handleOpenEmailTemplates} style={{ fontSize: 13 }}>
                  <Icon name="mail" size={13} /> Edit Email Templates
                </button>
              </div>
              <SectionSaveButton sectionKey="smtp" isDirty={isDirty} isSaving={saving} onSave={handleSave} />
            </div>
          </div>
        </div>
      </div>
      {emailTemplatesOpen && (
        <EmailTemplatesModal draft={emailTemplateDraft} onChange={setEmailTemplateDraft} onSave={handleSaveEmailTemplates} onCancel={() => setEmailTemplatesOpen(false)} saving={emailTemplatesSaving} />
      )}
    </>
  );
}

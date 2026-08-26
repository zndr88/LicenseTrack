import { useState, useCallback } from "react";
import { getGlobalSettings, updateGlobalSettings, sendTestEmail, triggerNotifications } from "../../../api/settings.js";
import { normalizeGlobalSettings } from "../../../utils/settingsNormalizer.js";
import { smtpSaveSchema, smtpConnectionSchema } from "../../../utils/settingsSchemas.js";
import { formatDate, formatDateTime } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import EmailTemplatesModal from "../EmailTemplatesModal.jsx";
import { SectionHeader, SectionSaveButton } from "../SectionShared.jsx";

const SMTP_ENCRYPTION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "starttls", label: "STARTTLS" },
  { value: "tls", label: "TLS / SSL" },
];

function notificationOutcomeLabel(status, summary) {
  const sent = Number(summary?.budget_owner_emails_sent ?? 0);
  const digest = summary?.digest_sent ? "The manager digest was sent." : "No manager digest was sent.";
  const blocked = Number(summary?.blocked?.length ?? 0);
  const failed = Number(summary?.error_count ?? summary?.errors?.length ?? 0);
  switch (status) {
    case "success": return `Completed successfully: ${sent} owner email(s). ${digest}`;
    case "partial": return `Partially completed: ${sent} owner email(s) sent; ${blocked} recipient(s) blocked and ${failed} delivery failure(s).`;
    case "blocked": return `Blocked by recipient policy: ${blocked} recipient(s) were not allowed.`;
    case "failed": return "Failed before all intended notification messages were delivered.";
    case "skipped": return summary?.reason === "email_disabled" ? "Skipped because email notifications are disabled." : "Skipped because SMTP is not configured.";
    case "no_work": return "No eligible notification items were found.";
    default: return "Notification run status is unavailable.";
  }
}

function notificationToastMessage(summary) {
  const status = summary?.status;
  if (status === "success") return "Notifications sent successfully.";
  if (status === "no_work") return "No eligible notifications were found.";
  if (status === "skipped") return summary.reason === "email_disabled" ? "Notifications skipped: email is disabled." : "Notifications skipped: SMTP is not configured.";
  if (status === "blocked") return `Notifications blocked: ${summary.blocked?.length ?? 0} recipient(s) failed the allowed-domain check.`;
  if (status === "partial") return `Notifications partially sent: ${summary.budget_owner_emails_sent ?? 0} owner email(s) delivered; ${summary.blocked?.length ?? 0} blocked, ${summary.errors?.length ?? 0} failed.`;
  if (status === "failed") return "Notifications failed before all intended messages were delivered.";
  return "Notification run completed with an unknown outcome.";
}

export default function SmtpSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, globalSettings, setGlobalSettings, onError, onToast, navGuard, userSettings }) {
  const [saving, setSaving] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [triggeringSending, setTriggeringSending] = useState(false);
  const [emailTemplatesOpen, setEmailTemplatesOpen] = useState(false);
  const [emailTemplateDraft, setEmailTemplateDraft] = useState({ emailTemplateBudgetOwnerIntro: "", emailTemplateBudgetOwnerSignoff: "", emailTemplateManagerIntro: "" });
  const [emailTemplatesSaving, setEmailTemplatesSaving] = useState(false);
  const unsavedSettingsMessage = "Save email settings before testing or sending notifications.";
  const smtpEncryption = globalSettings.smtpEncryption ?? (globalSettings.smtpUseTls ? "tls" : "starttls");

  const handleSave = async () => {
    const schema = globalSettings.emailEnabled ? smtpConnectionSchema : smtpSaveSchema;
    const validation = schema.safeParse({
      smtpHost: globalSettings.smtpHost,
      smtpPort: globalSettings.smtpPort,
      smtpEncryption,
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
      smtp_use_tls: smtpEncryption === "tls",
      smtp_encryption: smtpEncryption,
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
      smtpEncryption,
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
    const { data: refreshedSettings } = await getGlobalSettings();
    if (refreshedSettings) {
      setGlobalSettings((s) => normalizeGlobalSettings(refreshedSettings, s));
    }
    const status = data?.status;
    onToast(notificationToastMessage(data), ["partial", "blocked", "failed"].includes(status) ? "error" : "success");
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
            <div className="set-section-stack">
              <div className="trow set-toggle-row">
                <div>
                  <span className="set-toggle-title">Enable Email Notifications</span>
                  <div className="set-toggle-note">When off, no automated or manual notification emails will be sent. SMTP settings can still be configured while disabled.</div>
                </div>
                <Toggle value={globalSettings.emailEnabled ?? false} onChange={v => { setGlobalSettings(s => ({ ...s, emailEnabled: v })); markDirty("smtp"); }} />
              </div>
              <div className="fr">
                <div className="fg set-flex-double">
                  <label htmlFor="settings-smtp-host">SMTP Host</label>
                  <input id="settings-smtp-host" className="fi" value={globalSettings.smtpHost} onChange={e => { setGlobalSettings(s => ({ ...s, smtpHost: e.target.value })); markDirty("smtp"); }} placeholder="smtp.example.com" />
                </div>
                <div className="fg set-flex-fill">
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
                  <input id="settings-smtp-password" className="fi" type="password" autoComplete="off" value={globalSettings.smtpPassword} onChange={e => { setGlobalSettings(s => ({ ...s, smtpPassword: e.target.value })); markDirty("smtp"); }} placeholder="********" />
                </div>
              </div>
              <div className="fr">
                <div className="fg">
                  <label htmlFor="settings-smtp-sender">Sender Address</label>
                  <input id="settings-smtp-sender" className="fi" value={globalSettings.smtpSender} onChange={e => { setGlobalSettings(s => ({ ...s, smtpSender: e.target.value })); markDirty("smtp"); }} placeholder="LicenseTrack <noreply@example.com>" />
                </div>
                <div className="fg">
                  <label htmlFor="settings-smtp-encryption">Encryption</label>
                  <select id="settings-smtp-encryption" className="fi" value={smtpEncryption} onChange={e => { const value = e.target.value; setGlobalSettings(s => ({ ...s, smtpEncryption: value, smtpUseTls: value === "tls" })); markDirty("smtp"); }}>
                    {SMTP_ENCRYPTION_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="set-inline-actions">
                <button className="btn btn-g" onClick={handleTestEmail} disabled={testEmailSending || isDirty} title={isDirty ? unsavedSettingsMessage : undefined}>
                  <Icon name="mail" size={14} /> {testEmailSending ? "Sending..." : "Send Test Email"}
                </button>
                <button className="btn btn-g" onClick={handleTriggerNotifications} disabled={triggeringSending || !globalSettings.emailEnabled || isDirty} title={isDirty ? unsavedSettingsMessage : !globalSettings.emailEnabled ? "Enable email notifications to use this feature" : undefined}>
                  <Icon name="bell" size={14} /> {triggeringSending ? "Sending..." : "Send Notifications Now"}
                </button>
                <button type="button" className="btn btn-g set-form-button" onClick={handleOpenEmailTemplates}>
                  <Icon name="mail" size={13} /> Edit Email Templates
                </button>
              </div>
              {globalSettings.lastNotificationStatus && (
                <div className={`set-status-box ${["failed", "partial", "blocked"].includes(globalSettings.lastNotificationStatus) ? "set-status-box-failed" : "set-status-box-success"}`} role="status">
                  <strong>Last notification run:</strong>{" "}
                  {notificationOutcomeLabel(globalSettings.lastNotificationStatus, globalSettings.lastNotificationSummary)}
                  {globalSettings.lastNotificationAt && <span className="set-status-time">{formatDateTime(globalSettings.lastNotificationAt, userSettings)}</span>}
                  {globalSettings.lastNotificationAttemptDate && (
                    <div className="set-status-detail">
                      Scheduled attempt: {formatDate(globalSettings.lastNotificationAttemptDate, userSettings)}
                      {globalSettings.lastNotificationSentDate ? `; last successful run: ${formatDate(globalSettings.lastNotificationSentDate, userSettings)}` : "; no successful run recorded"}
                    </div>
                  )}
                  {globalSettings.lastNotificationAttemptDate === new Date().toISOString().slice(0, 10)
                    && ["failed", "partial", "blocked"].includes(globalSettings.lastNotificationStatus) && (
                    <div className="set-status-detail"><strong>Manual attention required for today's scheduled attempt.</strong></div>
                  )}
                </div>
              )}
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

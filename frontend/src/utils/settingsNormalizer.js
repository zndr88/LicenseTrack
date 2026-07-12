/**
 * Normalizes a raw global settings API response (snake_case) into the
 * camelCase shape used by App.jsx globalSettings state.
 *
 * @param {object} data - Raw API response from getGlobalSettings()
 * @param {object} current - Current globalSettings state (used as fallback for missing fields)
 * @returns {object} Normalized globalSettings object
 */
export function normalizeGlobalSettings(data, current) {
  return {
    ...current,
    mandatoryFields: data.mandatory_fields ?? current.mandatoryFields,
    authMethod: data.auth_method ?? current.authMethod,
    sessionTimeout: data.session_timeout ?? current.sessionTimeout,
    passwordMinLength: data.password_min_length ?? current.passwordMinLength,
    storagePath: data.storage_path ?? current.storagePath,
    notificationDays: data.notification_days ?? current.notificationDays,
    managerEmail: data.manager_email ?? current.managerEmail,
    smtpHost: data.smtp_host ?? current.smtpHost,
    smtpPort: data.smtp_port ?? current.smtpPort,
    smtpUsername: data.smtp_username ?? current.smtpUsername,
    smtpPassword: data.smtp_password ?? current.smtpPassword,
    smtpSender: data.smtp_sender ?? current.smtpSender,
    smtpUseTls: data.smtp_use_tls ?? current.smtpUseTls,
    notificationSendHour: data.notification_send_hour ?? current.notificationSendHour,
    allowedEmailDomains: data.allowed_email_domains !== undefined
      ? data.allowed_email_domains.split(",").filter(Boolean).map((d) => d.trim())
      : current.allowedEmailDomains,
    backupLocation: data.backup_location ?? current.backupLocation,
    backupEnabled: data.backup_enabled ?? current.backupEnabled,
    backupHour: data.backup_hour ?? current.backupHour,
    backupKeep: data.backup_keep ?? current.backupKeep,
    auditLogRetentionDays: data.audit_log_retention_days ?? current.auditLogRetentionDays,
    highValueThreshold: data.high_value_threshold !== undefined ? Number(data.high_value_threshold) : current.highValueThreshold,
    fiscalYearStartMonth: data.fiscal_year_start_month ?? current.fiscalYearStartMonth,
    emailEnabled: data.email_enabled ?? current.emailEnabled,
    oidcEnabled: data.oidc_enabled ?? current.oidcEnabled,
    oidcAvailable: data.oidc_available ?? current.oidcAvailable,
    oidcDiscoveryUrl: data.oidc_discovery_url ?? current.oidcDiscoveryUrl,
    oidcClientId: data.oidc_client_id ?? current.oidcClientId,
    oidcClientSecret: data.oidc_client_secret ?? current.oidcClientSecret,
    emailTemplateBudgetOwnerIntro: data.email_template_budget_owner_intro ?? current.emailTemplateBudgetOwnerIntro ?? "",
    emailTemplateBudgetOwnerSignoff: data.email_template_budget_owner_signoff ?? current.emailTemplateBudgetOwnerSignoff ?? "",
    emailTemplateManagerIntro: data.email_template_manager_intro ?? current.emailTemplateManagerIntro ?? "",
    lastBackupStatus: data.last_backup_status ?? current.lastBackupStatus,
    lastBackupAt: data.last_backup_at ?? current.lastBackupAt,
  };
}

/**
 * Normalizes a raw public global settings API response (snake_case) into the
 * partial camelCase shape used for non-admin sessions.
 *
 * @param {object} data - Raw API response from getGlobalSettingsPublic()
 * @param {object} current - Current globalSettings state (used as fallback)
 * @returns {object} Partial normalized globalSettings object
 */
export function normalizePublicGlobalSettings(data, current) {
  return {
    ...current,
    mandatoryFields: data.mandatory_fields ?? current.mandatoryFields,
    notificationDays: data.notification_days ?? current.notificationDays,
    oidcEnabled: data.oidc_enabled ?? current.oidcEnabled,
    oidcAvailable: data.oidc_available ?? current.oidcAvailable,
  };
}

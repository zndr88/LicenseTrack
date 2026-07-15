/**
 * Zod schemas for Settings section save validation.
 * Each schema covers only the fields validated before the API call.
 * Payload shapes remain unchanged - schemas only gate the save, not transform data.
 */
import { z } from "zod";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidSender(v) {
  const t = (v ?? "").trim();
  if (!t) return true; // optional
  const angleMatch = t.match(/<([^>]+)>/);
  const email = angleMatch ? angleMatch[1].trim() : t;
  return EMAIL_REGEX.test(email);
}

/** NotificationsSection - manager email (optional) + send hour (0-23). */
export const notificationsSaveSchema = z.object({
  managerEmail: z.string().refine(
    v => { const t = (v ?? "").trim(); return !t || EMAIL_REGEX.test(t); },
    { message: "Must be a valid email address." }
  ),
  notificationSendHour: z.number().int()
    .min(0, { message: "Must be an hour between 0 and 23." })
    .max(23, { message: "Must be an hour between 0 and 23." }),
});

/** SmtpSection - sender only; used when emailEnabled is false. */
export const smtpSaveSchema = z.object({
  smtpEncryption: z.enum(["none", "starttls", "tls"]).optional(),
  smtpSender: z.string().refine(isValidSender, {
    message: "Sender must be a valid email address or 'Name <email@example.com>'.",
  }),
});

/**
 * SmtpSection - full connection check used when emailEnabled is true
 * and before sending a test email (regardless of enabled state).
 * Host is required; port must be 1-65535; sender must be valid if set.
 */
export const smtpConnectionSchema = z.object({
  smtpHost: z.string().min(1, { message: "SMTP host is required." }),
  smtpPort: z.number().int()
    .min(1, { message: "Port must be between 1 and 65535." })
    .max(65535, { message: "Port must be between 1 and 65535." }),
  smtpEncryption: z.enum(["none", "starttls", "tls"]).optional(),
  smtpSender: z.string().refine(isValidSender, {
    message: "Sender must be a valid email address or 'Name <email@example.com>'.",
  }),
});

/**
 * OidcSection - used only when oidcEnabled is true.
 * Discovery URL must be a valid https:// URL; client ID must be non-empty.
 */
export const oidcEnabledSaveSchema = z.object({
  oidcDiscoveryUrl: z.string()
    .min(1, { message: "Discovery URL is required." })
    .refine(
      v => { try { return new URL(v).protocol === "https:"; } catch { return false; } },
      { message: "Discovery URL must be a valid HTTPS URL." }
    ),
  oidcClientId: z.string().min(1, { message: "Client ID is required." }),
});

/** BackupSection - backup hour (0-23), keep count (1-100), and audit retention (fixed set). */
export const backupSaveSchema = z.object({
  backupHour: z.number().int()
    .min(0, { message: "Must be an hour between 0 and 23." })
    .max(23, { message: "Must be an hour between 0 and 23." }),
  backupKeep: z.number().int()
    .min(1, { message: "Must be between 1 and 100." })
    .max(100, { message: "Must be between 1 and 100." }),
  auditLogRetentionDays: z.number().int().refine(
    v => [30, 60, 90, 180].includes(v),
    { message: "Audit log retention must be 30, 60, 90, or 180 days." }
  ),
});

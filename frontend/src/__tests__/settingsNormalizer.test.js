import { describe, expect, test } from 'vitest'
import { normalizeGlobalSettings } from '../utils/settingsNormalizer.js'

describe('normalizeGlobalSettings', () => {
  test('preserves explicit empty allowed domain settings from the API', () => {
    const normalized = normalizeGlobalSettings(
      {
        allowed_email_domains: '',
        session_timeout: 120,
        password_min_length: 14,
      },
      {
        allowedEmailDomains: ['example.com'],
        sessionTimeout: 30,
        passwordMinLength: 12,
      }
    )

    expect(normalized.allowedEmailDomains).toEqual([])
    expect(normalized.sessionTimeout).toBe(120)
    expect(normalized.passwordMinLength).toBe(14)
  })

  test('maps renewal/report and operational status fields on initial load', () => {
    const normalized = normalizeGlobalSettings(
      {
        high_value_threshold: '75000',
        fiscal_year_start_month: 4,
        last_backup_status: 'failed',
        last_backup_at: '2026-07-12T08:00:00Z',
        last_notification_sent_date: '2026-07-11',
        last_notification_attempt_date: '2026-07-12',
        last_notification_status: 'partial',
        last_notification_at: '2026-07-12T07:00:00Z',
        last_notification_summary: { error_count: 1 },
      },
      {
        highValueThreshold: 50000,
        fiscalYearStartMonth: 1,
        lastBackupStatus: null,
        lastBackupAt: null,
        lastNotificationSentDate: null,
        lastNotificationAttemptDate: null,
        lastNotificationStatus: null,
        lastNotificationAt: null,
        lastNotificationSummary: null,
      }
    )

    expect(normalized.highValueThreshold).toBe(75000)
    expect(normalized.fiscalYearStartMonth).toBe(4)
    expect(normalized.lastBackupStatus).toBe('failed')
    expect(normalized.lastBackupAt).toBe('2026-07-12T08:00:00Z')
    expect(normalized.lastNotificationSentDate).toBe('2026-07-11')
    expect(normalized.lastNotificationAttemptDate).toBe('2026-07-12')
    expect(normalized.lastNotificationStatus).toBe('partial')
    expect(normalized.lastNotificationAt).toBe('2026-07-12T07:00:00Z')
    expect(normalized.lastNotificationSummary).toEqual({ error_count: 1 })
  })

  test('maps explicit SMTP encryption and legacy TLS fallback', () => {
    expect(normalizeGlobalSettings(
      { smtp_encryption: 'none', smtp_use_tls: false },
      { smtpEncryption: 'starttls', smtpUseTls: true }
    ).smtpEncryption).toBe('none')

    expect(normalizeGlobalSettings(
      { smtp_use_tls: true },
      { smtpEncryption: 'starttls', smtpUseTls: false }
    ).smtpEncryption).toBe('tls')
  })
})

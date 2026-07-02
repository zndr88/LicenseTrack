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
})

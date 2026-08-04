import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("../api/settings.js", () => ({
  updateGlobalSettings: vi.fn(),
  sendTestEmail: vi.fn(),
  triggerNotifications: vi.fn(),
  triggerBackup: vi.fn(),
  listBackups: vi.fn().mockResolvedValue({ data: [], error: null }),
}));

vi.mock("../utils/settingsNormalizer.js", () => ({
  normalizeGlobalSettings: vi.fn((data, current) => current),
}));

// EmailTemplatesModal is conditionally rendered — mock to keep test simple
vi.mock("../components/settings/EmailTemplatesModal.jsx", () => ({
  default: () => null,
}));

import { updateGlobalSettings, sendTestEmail, triggerBackup, triggerNotifications } from "../api/settings.js";
import NotificationsSection from "../components/settings/sections/NotificationsSection.jsx";
import SmtpSection from "../components/settings/sections/SmtpSection.jsx";
import OidcSection from "../components/settings/sections/OidcSection.jsx";
import BackupSection from "../components/settings/sections/BackupSection.jsx";
import CompletenessSection from "../components/settings/sections/CompletenessSection.jsx";

// ─── shared helpers ──────────────────────────────────────────────────────────

function baseNotificationsSettings(overrides = {}) {
  return {
    notificationDays: 30,
    managerEmail: "manager@company.com",
    notificationSendHour: 7,
    allowedEmailDomains: [],
    ...overrides,
  };
}

function baseSmtpSettings(overrides = {}) {
  return {
    emailEnabled: false,
    smtpHost: "smtp.company.com",
    smtpPort: 587,
    smtpUsername: "notifications@company.com",
    smtpPassword: "",
    smtpSender: "Notices <noreply@company.com>",
    smtpUseTls: false,
    smtpEncryption: "starttls",
    managerEmail: "manager@company.com",
    emailTemplateBudgetOwnerIntro: "",
    emailTemplateBudgetOwnerSignoff: "",
    emailTemplateManagerIntro: "",
    ...overrides,
  };
}

function baseOidcSettings(overrides = {}) {
  return {
    oidcEnabled: false,
    oidcDiscoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
    oidcClientId: "my-client-id",
    oidcClientSecret: "",
    oidcAvailable: false,
    ...overrides,
  };
}

function baseBackupSettings(overrides = {}) {
  return {
    backupLocation: "./backups",
    backupEnabled: false,
    backupHour: 2,
    backupKeep: 10,
    auditLogRetentionDays: 90,
    lastBackupStatus: null,
    lastBackupAt: null,
    ...overrides,
  };
}

function baseCompletenessSettings(overrides = {}) {
  return {
    mandatoryFields: {
      invoice: true,
      purchaseOrder: true,
      quote: false,
      eula: false,
      entitlement: false,
      startDate: false,
      endDate: false,
      contractNumber: false,
      poNumber: false,
      invoiceNumber: false,
      contactEmail: false,
      costCentre: false,
      budgetOwnerEmail: false,
    },
    ...overrides,
  };
}

function sectionProps(globalSettings, overrides = {}) {
  return {
    isOpen: true,
    isDirty: true,
    onToggle: vi.fn(),
    markDirty: vi.fn(),
    clearDirty: vi.fn(),
    globalSettings,
    setGlobalSettings: vi.fn(),
    onError: vi.fn(),
    onToast: vi.fn(),
    navGuard: null,
    ...overrides,
  };
}

// ─── NotificationsSection ────────────────────────────────────────────────────

describe("CompletenessSection save side effects", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("refreshes derived completeness caches after a successful save", async () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const onCompletenessRulesChanged = vi.fn();

    render(
      <CompletenessSection
        {...sectionProps(baseCompletenessSettings(), { onCompletenessRulesChanged })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onCompletenessRulesChanged).toHaveBeenCalledTimes(1));
  });
});

describe("NotificationsSection validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("rejects invalid manager email before calling the API", () => {
    const onError = vi.fn();
    const settings = baseNotificationsSettings({ managerEmail: "not-an-email" });
    render(<NotificationsSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts empty manager email (optional field)", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseNotificationsSettings({ managerEmail: "" });
    render(<NotificationsSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("rejects invalid send hour before calling the API", () => {
    const onError = vi.fn();
    const settings = baseNotificationsSettings({ notificationSendHour: 25 });
    render(<NotificationsSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("preserves midnight when the notification hour input changes to zero", () => {
    const settings = baseNotificationsSettings({ notificationSendHour: 7 });
    let nextSettings = settings;
    const setGlobalSettings = vi.fn((updater) => {
      nextSettings = updater(nextSettings);
    });
    render(
      <NotificationsSection
        {...sectionProps(settings, { setGlobalSettings })}
      />
    );

    fireEvent.change(screen.getByLabelText(/Daily Send Time/i), {
      target: { value: "0" },
    });

    expect(nextSettings.notificationSendHour).toBe(0);
  });

  test("rejects invalid allowed domain and does not add it to the list", () => {
    const onError = vi.fn();
    const setGlobalSettings = vi.fn();
    const settings = baseNotificationsSettings({ allowedEmailDomains: [] });

    render(
      <NotificationsSection
        {...sectionProps(settings, { onError, setGlobalSettings })}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/example.com/i), {
      target: { value: "nodot" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onError).toHaveBeenCalled();
    expect(setGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts valid domain and adds it to the list", () => {
    const setGlobalSettings = vi.fn();
    const settings = baseNotificationsSettings({ allowedEmailDomains: [] });

    render(
      <NotificationsSection
        {...sectionProps(settings, { setGlobalSettings })}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/example.com/i), {
      target: { value: "company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(setGlobalSettings).toHaveBeenCalled();
  });

  test("clears dirty state after a successful save", async () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const clearDirty = vi.fn();
    const settings = baseNotificationsSettings({ managerEmail: "" });
    render(<NotificationsSection {...sectionProps(settings, { clearDirty })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(clearDirty).toHaveBeenCalledWith("notifications"));
  });
});

// ─── SmtpSection ─────────────────────────────────────────────────────────────

describe("SmtpSection validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("rejects invalid SMTP sender before calling the API", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ smtpSender: "not-an-email" });
    render(<SmtpSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts empty sender (optional field)", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseSmtpSettings({ smtpSender: "" });
    render(<SmtpSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("accepts valid display-name sender format", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseSmtpSettings({
      smtpSender: "LicenseTrack <noreply@company.com>",
    });
    render(<SmtpSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("clears dirty state after a successful save", async () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const clearDirty = vi.fn();
    const settings = baseSmtpSettings({ smtpSender: "" });
    render(<SmtpSection {...sectionProps(settings, { clearDirty })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(clearDirty).toHaveBeenCalledWith("smtp"));
  });
});

// ─── SmtpSection — host/port and test-email validation (Stage 4B) ────────────

describe("SmtpSection host/port validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("rejects blank host when email is enabled", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ emailEnabled: true, smtpHost: "" });
    render(<SmtpSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("rejects port out of range (0) when email is enabled", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ emailEnabled: true, smtpPort: 0 });
    render(<SmtpSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("rejects port out of range (>65535) when email is enabled", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ emailEnabled: true, smtpPort: 65536 });
    render(<SmtpSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("allows blank host when email is disabled (host not required)", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseSmtpSettings({ emailEnabled: false, smtpHost: "", smtpSender: "" });
    render(<SmtpSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("accepts valid host/port/sender when email is enabled", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseSmtpSettings({ emailEnabled: true });
    render(<SmtpSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });
});

describe("SmtpSection test-email validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
    sendTestEmail.mockReset();
  });

  test("blocks test email when host is blank", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ smtpHost: "" });
    render(<SmtpSection {...sectionProps(settings, { isDirty: false, onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /send test email/i }));

    expect(onError).toHaveBeenCalled();
    expect(sendTestEmail).not.toHaveBeenCalled();
  });

  test("blocks test email when sender is invalid", () => {
    const onError = vi.fn();
    const settings = baseSmtpSettings({ smtpSender: "bad-email" });
    render(<SmtpSection {...sectionProps(settings, { isDirty: false, onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /send test email/i }));

    expect(onError).toHaveBeenCalled();
    expect(sendTestEmail).not.toHaveBeenCalled();
  });

  test("calls sendTestEmail when host/port/sender are valid", async () => {
    sendTestEmail.mockResolvedValue({ data: {}, error: null });
    const settings = baseSmtpSettings({ emailEnabled: false });
    render(<SmtpSection {...sectionProps(settings, { isDirty: false })} />);

    fireEvent.click(screen.getByRole("button", { name: /send test email/i }));

    await waitFor(() => expect(sendTestEmail).toHaveBeenCalled());
  });

  test("blocks test email and manual notifications when SMTP settings are unsaved", () => {
    const settings = baseSmtpSettings({ emailEnabled: true });
    render(<SmtpSection {...sectionProps(settings, { isDirty: true })} />);

    expect(screen.getByRole("button", { name: /send test email/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send notifications now/i })).toBeDisabled();
    expect(sendTestEmail).not.toHaveBeenCalled();
    expect(triggerNotifications).not.toHaveBeenCalled();
  });
});

// ─── OidcSection ─────────────────────────────────────────────────────────────

describe("OidcSection validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("rejects invalid discovery URL when OIDC is enabled", () => {
    const onError = vi.fn();
    const settings = baseOidcSettings({
      oidcEnabled: true,
      oidcDiscoveryUrl: "not-a-url",
    });
    render(<OidcSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("allows http discovery URL when OIDC is enabled", () => {
    const onError = vi.fn();
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseOidcSettings({
      oidcEnabled: true,
      oidcDiscoveryUrl: "http://idp.example.com/.well-known/openid-configuration",
    });
    render(<OidcSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).not.toHaveBeenCalled();
    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("rejects empty client ID when OIDC is enabled", () => {
    const onError = vi.fn();
    const settings = baseOidcSettings({
      oidcEnabled: true,
      oidcDiscoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
      oidcClientId: "",
    });
    render(<OidcSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts valid URL and client ID when OIDC is enabled", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseOidcSettings({ oidcEnabled: true });
    render(<OidcSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("does not require client secret when OIDC is enabled", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseOidcSettings({ oidcEnabled: true, oidcClientSecret: "" });
    render(<OidcSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("skips URL/client-ID validation when OIDC is disabled", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseOidcSettings({
      oidcEnabled: false,
      oidcDiscoveryUrl: "",
      oidcClientId: "",
    });
    render(<OidcSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("disabling OIDC sends oidc_enabled:false regardless of field state (local admin fallback)", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseOidcSettings({
      oidcEnabled: false,
      oidcDiscoveryUrl: "",
      oidcClientId: "",
      oidcClientSecret: "",
    });
    render(<OidcSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalledWith(
      expect.objectContaining({ oidc_enabled: false })
    );
  });

  test("clears dirty state after a successful save", async () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const clearDirty = vi.fn();
    const settings = baseOidcSettings({ oidcEnabled: false });
    render(<OidcSection {...sectionProps(settings, { clearDirty })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(clearDirty).toHaveBeenCalledWith("oidc"));
  });
});

// ─── BackupSection ────────────────────────────────────────────────────────────

describe("BackupSection validation", () => {
  beforeEach(() => {
    updateGlobalSettings.mockReset();
  });

  test("rejects backup hour out of range (>23)", () => {
    const onError = vi.fn();
    const settings = baseBackupSettings({ backupHour: 25 });
    render(<BackupSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("rejects backup hour out of range (<0)", () => {
    const onError = vi.fn();
    const settings = baseBackupSettings({ backupHour: -1 });
    render(<BackupSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("rejects backup keep value of 0", () => {
    const onError = vi.fn();
    const settings = baseBackupSettings({ backupKeep: 0 });
    render(<BackupSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("rejects backup keep value exceeding 100", () => {
    const onError = vi.fn();
    const settings = baseBackupSettings({ backupKeep: 101 });
    render(<BackupSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts valid hour and keep values and calls the API", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseBackupSettings({ backupHour: 2, backupKeep: 10 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("accepts hour boundary value 0 (midnight)", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseBackupSettings({ backupHour: 0 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("preserves midnight when the backup hour input changes to zero", () => {
    const settings = baseBackupSettings({ backupHour: 2 });
    let nextSettings = settings;
    const setGlobalSettings = vi.fn((updater) => {
      nextSettings = updater(nextSettings);
    });
    render(
      <BackupSection
        {...sectionProps(settings, { setGlobalSettings })}
      />
    );

    fireEvent.change(screen.getByLabelText(/Daily Database Backup Hour/i), {
      target: { value: "0" },
    });

    expect(nextSettings.backupHour).toBe(0);
  });

  test("accepts hour boundary value 23", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseBackupSettings({ backupHour: 23 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("accepts keep boundary value 1", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseBackupSettings({ backupKeep: 1 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("accepts keep boundary value 100", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const settings = baseBackupSettings({ backupKeep: 100 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(updateGlobalSettings).toHaveBeenCalled();
  });

  test("rejects audit retention value not in the allowed set", () => {
    const onError = vi.fn();
    const settings = baseBackupSettings({ auditLogRetentionDays: 45 });
    render(<BackupSection {...sectionProps(settings, { onError })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onError).toHaveBeenCalled();
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("accepts all valid audit retention values", () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    for (const days of [30, 60, 90, 180]) {
      updateGlobalSettings.mockClear();
      const settings = baseBackupSettings({ auditLogRetentionDays: days });
      const { unmount } = render(<BackupSection {...sectionProps(settings)} />);

      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(updateGlobalSettings).toHaveBeenCalledWith(
        expect.objectContaining({ audit_log_retention_days: days })
      );
      unmount();
    }
  });

  test("Create Database Backup calls triggerBackup without any save validation gate", async () => {
    triggerBackup.mockResolvedValue({ data: { filename: "backup-2026.db" }, error: null });
    // hour/keep intentionally valid — confirming triggerBackup path is unaffected by save schema
    const settings = baseBackupSettings({ backupHour: 2, backupKeep: 10 });
    render(<BackupSection {...sectionProps(settings)} />);

    fireEvent.click(screen.getByRole("button", { name: /create database backup/i }));

    await waitFor(() => expect(triggerBackup).toHaveBeenCalled());
    expect(updateGlobalSettings).not.toHaveBeenCalled();
  });

  test("clears dirty state after a successful save", async () => {
    updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
    const clearDirty = vi.fn();
    const settings = baseBackupSettings({ backupHour: 2, backupKeep: 10 });
    render(<BackupSection {...sectionProps(settings, { clearDirty })} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(clearDirty).toHaveBeenCalledWith("backup"));
  });
});

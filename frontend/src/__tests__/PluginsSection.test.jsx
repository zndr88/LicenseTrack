import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PluginsSection from "../components/settings/sections/PluginsSection.jsx";
import {
  disablePlugin,
  enablePlugin,
  getPluginHostStatus,
  getPluginSettings,
  installPlugin,
  listPlugins,
  previewPluginInstall,
  uninstallPlugin,
  updatePluginSettings,
} from "../api/plugins.js";

vi.mock("../api/plugins.js", () => ({
  getPluginHostStatus: vi.fn(),
  listPlugins: vi.fn(),
  getPluginSettings: vi.fn(),
  updatePluginSettings: vi.fn(),
  previewPluginInstall: vi.fn(),
  installPlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

const installedPlugin = {
  id: 1,
  key: "licensetrack-ai",
  name: "LicenseTrack AI",
  publisherName: "LicenseTrack",
  description: "AI-assisted document parsing.",
  installedVersion: "0.1.0",
  status: "disabled",
  enabled: false,
  compatibilityStatus: "compatible",
  trustStatus: "verified",
  signerKeyId: "licensetrack-test-2026",
  signerIdentity: "LicenseTrack Project",
  installPath: "/data/plugins/licensetrack-ai/0.1.0",
  manifest: {},
  lastError: null,
  createdAt: "2026-06-13T10:00:00Z",
  updatedAt: "2026-06-13T10:00:00Z",
  versions: [{ version: "0.1.0", checksumSha256: "a".repeat(64) }],
  permissions: [
    { id: 1, permission: "documents:read", granted: false, grantedBy: null, grantedAt: null },
  ],
  settingDefinitions: [
    { id: 1, settingKey: "anthropicApiKey", settingType: "secret", label: "Anthropic API Key", required: true },
  ],
  actions: [
    { id: 1, actionKey: "parseQuote", label: "Parse Quote", slot: "sourcing.item.edit.actions", enabled: false },
  ],
  runtimeStatus: { id: 1, health: "unknown" },
};

const preview = {
  installable: true,
  checksumSha256: "a".repeat(64),
  packageSizeBytes: 1024,
  compatibilityStatus: "compatible",
  trustStatus: "verified",
  signerKeyId: "licensetrack-test-2026",
  signerIdentity: "LicenseTrack Project",
  issues: [],
  permissions: [
    {
      permission: "documents:read",
      description: "Read documents included in an action context.",
      risk: "high",
    },
  ],
  manifest: {
    key: "licensetrack-ai",
    name: "LicenseTrack AI",
    version: "0.1.0",
    publisher: { name: "LicenseTrack" },
    description: "AI-assisted document parsing.",
    actions: [
      {
        key: "parseQuote",
        label: "Parse Quote",
        slot: "sourcing.item.edit.actions",
      },
    ],
  },
};

const pluginSettings = {
  pluginKey: "licensetrack-ai",
  missingRequired: ["anthropicApiKey"],
  definitions: [
    {
      id: 1,
      settingKey: "anthropicApiKey",
      settingType: "secret",
      label: "Anthropic API Key",
      required: true,
      helpText: "Provider credential.",
    },
    {
      id: 2,
      settingKey: "model",
      settingType: "select",
      label: "Model",
      required: true,
      options: ["fast", "accurate"],
    },
    {
      id: 3,
      settingKey: "enabled",
      settingType: "boolean",
      label: "Enabled",
      required: false,
    },
  ],
  values: [
    { key: "anthropicApiKey", value: null, masked: false, required: true, configured: false },
    { key: "model", value: "fast", masked: false, required: true, configured: true },
    { key: "enabled", value: false, masked: false, required: false, configured: true },
  ],
};

function renderSection(props = {}) {
  return render(
    <PluginsSection
      isOpen
      isDirty={false}
      onToggle={vi.fn()}
      onError={vi.fn()}
      onToast={vi.fn()}
      {...props}
    />,
  );
}

describe("PluginsSection", () => {
  beforeEach(() => {
    getPluginHostStatus.mockReset();
    listPlugins.mockReset();
    getPluginSettings.mockReset();
    updatePluginSettings.mockReset();
    previewPluginInstall.mockReset();
    installPlugin.mockReset();
    enablePlugin.mockReset();
    disablePlugin.mockReset();
    uninstallPlugin.mockReset();
    getPluginHostStatus.mockResolvedValue({
      data: { enabled: true, developerMode: false, trustedKeyCount: 1 },
      error: null,
    });
    listPlugins.mockResolvedValue({ data: [], error: null });
    getPluginSettings.mockResolvedValue({ data: pluginSettings, error: null });
    enablePlugin.mockResolvedValue({ data: { ...installedPlugin, status: "enabled", enabled: true }, error: null });
    disablePlugin.mockResolvedValue({ data: installedPlugin, error: null });
    uninstallPlugin.mockResolvedValue({ data: null, error: null });
  });

  test("loads and renders installed plugin metadata", async () => {
    listPlugins.mockResolvedValue({ data: [installedPlugin], error: null });

    renderSection();

    expect((await screen.findAllByText("LicenseTrack AI")).length).toBeGreaterThan(0);
    expect(screen.getByText("licensetrack-ai")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Anthropic API Key/i)).toBeInTheDocument();
    expect(screen.getByText("Parse Quote")).toBeInTheDocument();
    expect(getPluginSettings).toHaveBeenCalledWith("licensetrack-ai");
  });

  test("shows an empty state when no plugins are installed", async () => {
    renderSection();

    expect(await screen.findByText("No Official Extensions installed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose package/i })).toBeInTheDocument();
  });

  test("preview renders plugin identity permissions and actions", async () => {
    const user = userEvent.setup();
    previewPluginInstall.mockResolvedValue({ data: preview, error: null });
    renderSection();

    await screen.findByText("No Official Extensions installed");
    await user.click(screen.getByRole("button", { name: /upload install/i }));
    const input = screen.getByLabelText(/official extension package zip/i);
    const file = new File(["zip"], "plugin.zip", { type: "application/zip" });
    await user.upload(input, file);

    expect(await screen.findByText("Installable")).toBeInTheDocument();
    expect(screen.getAllByText("LicenseTrack AI").length).toBeGreaterThan(0);
    expect(screen.getByText("documents:read")).toBeInTheDocument();
    expect(screen.getByText("sourcing.item.edit.actions")).toBeInTheDocument();
    expect(screen.getByText("LicenseTrack Project")).toBeInTheDocument();
    expect(screen.getByText("licensetrack-test-2026")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  test("invalid preview disables install and shows validation issues", async () => {
    const user = userEvent.setup();
    previewPluginInstall.mockResolvedValue({
      data: {
        ...preview,
        installable: false,
        manifest: null,
        issues: [{ code: "manifest_location_invalid", severity: "error", message: "Package must contain plugin.ltplugin." }],
      },
      error: null,
    });
    renderSection();

    await screen.findByText("No Official Extensions installed");
    await user.click(screen.getByRole("button", { name: /upload install/i }));
    await user.upload(screen.getByLabelText(/official extension package zip/i), new File(["zip"], "bad.zip", { type: "application/zip" }));

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Package must contain plugin.ltplugin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install disabled/i })).toBeDisabled();
  });

  test("successful install closes modal and adds plugin to the list", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    previewPluginInstall.mockResolvedValue({ data: preview, error: null });
    installPlugin.mockResolvedValue({ data: installedPlugin, error: null });
    renderSection({ onToast });

    await screen.findByText("No Official Extensions installed");
    await user.click(screen.getByRole("button", { name: /upload install/i }));
    await user.upload(screen.getByLabelText(/official extension package zip/i), new File(["zip"], "plugin.zip", { type: "application/zip" }));
    await screen.findByText("Installable");
    fireEvent.click(screen.getByRole("button", { name: /install disabled/i }));

    await waitFor(() => expect(installPlugin).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith('Official Extension "LicenseTrack AI" installed disabled.', "info");
    const table = screen.getByRole("table");
    expect(within(table).getByText("LicenseTrack AI")).toBeInTheDocument();
  });

  test("renders and saves plugin settings", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const clearDirty = vi.fn();
    const markDirty = vi.fn();
    listPlugins.mockResolvedValue({ data: [installedPlugin], error: null });
    updatePluginSettings.mockResolvedValue({
      data: {
        ...pluginSettings,
        missingRequired: [],
        values: [
          { key: "anthropicApiKey", value: "••••••••", masked: true, required: true, configured: true },
          { key: "model", value: "accurate", masked: false, required: true, configured: true },
          { key: "enabled", value: true, masked: false, required: false, configured: true },
        ],
      },
      error: null,
    });

    renderSection({ onToast, markDirty, clearDirty });

    expect(await screen.findByLabelText(/Anthropic API Key/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Anthropic API Key/i), "sk-test");
    await user.selectOptions(screen.getByLabelText(/Model/i), "accurate");
    await user.click(screen.getByRole("switch", { name: /Enabled/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(updatePluginSettings).toHaveBeenCalledWith("licensetrack-ai", [
      { key: "anthropicApiKey", value: "sk-test", masked: false },
      { key: "model", value: "accurate", masked: false },
      { key: "enabled", value: true, masked: false },
    ]));
    expect(markDirty).toHaveBeenCalledWith("plugins");
    expect(clearDirty).toHaveBeenCalledWith("plugins");
    expect(onToast).toHaveBeenCalledWith("Official Extension settings saved.", "info");
  });

  test("masked secret value is preserved on save", async () => {
    const user = userEvent.setup();
    listPlugins.mockResolvedValue({ data: [installedPlugin], error: null });
    getPluginSettings.mockResolvedValue({
      data: {
        ...pluginSettings,
        missingRequired: [],
        values: [
          { key: "anthropicApiKey", value: "••••••••", masked: true, required: true, configured: true },
          { key: "model", value: "fast", masked: false, required: true, configured: true },
          { key: "enabled", value: false, masked: false, required: false, configured: true },
        ],
      },
      error: null,
    });
    updatePluginSettings.mockResolvedValue({ data: pluginSettings, error: null });

    renderSection();

    expect(await screen.findByLabelText(/Anthropic API Key/i)).toHaveValue("••••••••");
    await user.selectOptions(screen.getByLabelText(/Model/i), "accurate");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(updatePluginSettings).toHaveBeenCalledWith(
      "licensetrack-ai",
      expect.arrayContaining([
        { key: "anthropicApiKey", value: "••••••••", masked: true },
      ]),
    ));
  });

  test("enables and disables an installed plugin", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    listPlugins.mockResolvedValue({ data: [installedPlugin], error: null });

    renderSection({ onToast });

    expect(await screen.findByRole("button", { name: /enable/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /enable/i }));
    await user.click(screen.getByRole("button", { name: /enable extension/i }));

    await waitFor(() => expect(enablePlugin).toHaveBeenCalledWith("licensetrack-ai"));
    expect(onToast).toHaveBeenCalledWith('Official Extension "LicenseTrack AI" enabled.', "info");

    await user.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(disablePlugin).toHaveBeenCalledWith("licensetrack-ai"));
    expect(onToast).toHaveBeenCalledWith('Official Extension "LicenseTrack AI" disabled.', "info");
  });

  test("confirms and uninstalls a plugin", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listPlugins.mockResolvedValue({ data: [installedPlugin], error: null });

    renderSection({ onToast });

    expect((await screen.findAllByText("LicenseTrack AI")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /uninstall/i }));

    await waitFor(() => expect(uninstallPlugin).toHaveBeenCalledWith("licensetrack-ai"));
    expect(onToast).toHaveBeenCalledWith('Official Extension "LicenseTrack AI" uninstalled.', "info");
    expect(await screen.findByText("No Official Extensions installed")).toBeInTheDocument();
  });

  test("distinguishes developer packages and blocks unverified packages", async () => {
    getPluginHostStatus.mockResolvedValue({
      data: { enabled: true, developerMode: true, trustedKeyCount: 0 },
      error: null,
    });
    listPlugins.mockResolvedValue({
      data: [{ ...installedPlugin, trustStatus: "developer", signerKeyId: null, signerIdentity: null }],
      error: null,
    });

    const { rerender } = renderSection();

    expect(await screen.findByText(/Developer package\. It is not verified or official/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable$/i })).toBeEnabled();

    listPlugins.mockResolvedValue({
      data: [{ ...installedPlugin, trustStatus: "unverified", signerKeyId: null, signerIdentity: null }],
      error: null,
    });
    rerender(
      <PluginsSection
        isOpen
        isDirty={false}
        onToggle={vi.fn()}
        onError={vi.fn()}
        onToast={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(screen.getByText(/Unverified package\. Reinstall a signed official release/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /enable$/i })).toBeDisabled();
  });

  test("hides the section when the Official Extension host is unavailable", async () => {
    getPluginHostStatus.mockResolvedValue({
      data: { enabled: false, developerMode: false, trustedKeyCount: 0 },
      error: null,
    });

    renderSection();

    await waitFor(() => expect(getPluginHostStatus).toHaveBeenCalled());
    expect(screen.queryByText("Official Extensions")).not.toBeInTheDocument();
    expect(listPlugins).not.toHaveBeenCalled();
  });
});

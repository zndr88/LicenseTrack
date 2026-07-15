import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapWithQueryClient(ui) {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

import LicensesPage from "../components/pages/LicensesPage.jsx";
import CSVImportPage from "../components/pages/CSVImportPage.jsx";
import SettingsPage from "../components/pages/SettingsPage.jsx";
import UsersPage from "../components/pages/UsersPage.jsx";
import ContractsPage from "../components/pages/ContractsPage.jsx";
import SourcingPage from "../components/pages/SourcingPage.jsx";
import PendingOrdersPage from "../components/pages/PendingOrdersPage.jsx";
import ReportsPage from "../components/pages/ReportsPage.jsx";
import NotificationsPage from "../components/pages/NotificationsPage.jsx";

import * as licensesApi from "../api/licenses.js";
import * as csvImportApi from "../api/csvImport.js";
import * as settingsApi from "../api/settings.js";
import * as usersApi from "../api/users.js";
import * as contractsApi from "../api/contracts.js";
import * as sourcingApi from "../api/sourcing.js";
import * as pendingOrdersApi from "../api/pendingOrders.js";
import * as pdfExport from "../utils/pdfExport.js";

vi.mock("recharts", () => {
  const passthrough = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    Bar: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    CartesianGrid: passthrough,
    Tooltip: passthrough,
    Cell: passthrough,
    PieChart: passthrough,
    Pie: passthrough,
  };
});

vi.mock("../api/licenses.js", () => ({
  getLicenses: vi.fn(),
  getLicense: vi.fn(),
  updateLicense: vi.fn(),
  patchLicenseField: vi.fn(),
  deleteLicense: vi.fn(),
  bulkDeleteLicenses: vi.fn(),
  getStats: vi.fn(),
  initiateRenewal: vi.fn(),
  cancelRenewal: vi.fn(),
  getAllCustomFieldValues: vi.fn(),
  getCustomFieldValues: vi.fn(),
  upsertCustomFieldValues: vi.fn(),
  getMaintenanceForParent: vi.fn(),
  disableMaintenance: vi.fn(),
}));

vi.mock("../api/csvImport.js", () => ({
  previewCsvImport: vi.fn(),
  confirmCsvImport: vi.fn(),
  downloadCsvTemplate: vi.fn(),
  analyzeImport: vi.fn(),
  executeImport: vi.fn(),
  previewMappedImport: vi.fn(),
  listImportMappings: vi.fn(),
  deleteImportMapping: vi.fn(),
  putImportMapping: vi.fn(),
}));

vi.mock("../api/settings.js", () => ({
  updateSettings: vi.fn(),
  updateGlobalSettings: vi.fn(),
  sendTestEmail: vi.fn(),
  triggerNotifications: vi.fn(),
  triggerBackup: vi.fn(),
  listBackups: vi.fn(),
  restoreBackup: vi.fn(),
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  deleteCustomField: vi.fn(),
  updateCustomFieldSection: vi.fn(),
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  retryWebhookDelivery: vi.fn(),
  testWebhook: vi.fn(),
  listExtensionCapabilities: vi.fn(),
  upsertExtensionCapability: vi.fn(),
  deleteExtensionCapability: vi.fn(),
}));

vi.mock("../api/users.js", () => ({
  getUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  updateRole: vi.fn(),
  deleteUser: vi.fn(),
  resetUserPassword: vi.fn(),
  getDepartments: vi.fn(),
  getUserDepartments: vi.fn(),
  updateUserDepartments: vi.fn(),
}));

vi.mock("../api/contracts.js", () => ({
  getContracts: vi.fn(),
  createContract: vi.fn(),
  deleteContract: vi.fn(),
  getContract: vi.fn(),
  updateContract: vi.fn(),
  getContractLicenses: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  getContractDocuments: vi.fn(),
  uploadContractDocument: vi.fn(),
  downloadContractDocument: vi.fn(),
  deleteContractDocument: vi.fn(),
}));

vi.mock("../api/sourcing.js", () => ({
  getSourcingItems: vi.fn(),
  getSourcingRequests: vi.fn(),
  getSourcingItem: vi.fn(),
  createSourcingItem: vi.fn(),
  createSourcingRequest: vi.fn(),
  addSourcingRequestItem: vi.fn(),
  updateSourcingItem: vi.fn(),
  deleteSourcingItem: vi.fn(),
  deleteSourcingRequest: vi.fn(),
  convertSourcingItem: vi.fn(),
  convertSourcingRequest: vi.fn(),
  mergeSourcingItems: vi.fn(),
  exportSourcingCsv: vi.fn(),
}));

vi.mock("../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn(),
  getPendingOrder: vi.fn(),
  createPendingOrder: vi.fn(),
  updatePendingOrder: vi.fn(),
  deletePendingOrder: vi.fn(),
  uploadPendingOrderDocument: vi.fn(),
  downloadPendingOrderDocument: vi.fn(),
  convertPendingOrder: vi.fn(),
  batchConvertPendingOrder: vi.fn(),
  retryPendingOrderEvidenceTransfer: vi.fn(),
  exportPendingOrdersCsv: vi.fn(),
}));

vi.mock("../utils/pdfExport.js", () => ({
  exportFullReportPdf: vi.fn(),
}));

vi.mock("../components/contracts/ContractModal.jsx", () => ({
  default: ({ contractId }) => <div role="dialog">Contract {contractId} opened</div>,
}));

vi.mock("../components/procurement/SourcingItemModal.jsx", () => ({
  default: ({ onSave, onCancel }) => (
    <div role="dialog" aria-label="Sourcing item form">
      <button onClick={() => onSave({
        publisherName: "Created Publisher",
        softwareDescription: "Created Sourcing App",
        quantity: "3",
        currency: "EUR",
      })}>
        Save sourcing item
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock("../components/procurement/PendingOrderModal.jsx", () => ({
  default: ({ onSave, onCancel }) => (
    <div role="dialog" aria-label="Pending order form">
      <button onClick={() => onSave({ poNumber: "PO-NEW", supplier: "Created Supplier", notes: "" })}>
        Save pending order
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock("../components/procurement/ConvertSourcingModal.jsx", () => ({
  default: () => <div role="dialog">Convert sourcing</div>,
}));

vi.mock("../components/procurement/ConvertPendingOrderModal.jsx", () => ({
  default: () => <div role="dialog">Convert pending order</div>,
}));

vi.mock("../components/procurement/ConvertAllModal.jsx", () => ({
  default: () => <div role="dialog">Convert all pending order items</div>,
}));

const admin = { id: 1, role: "admin", username: "admin" };
const userSettings = {
  theme: "light",
  displayCurrency: "EUR",
  numberFormatLocale: "en-US",
  visibleInList: {},
  visibleInDetail: {},
  columnOrder: [],
  savedViews: [],
  sidebarCollapsed: false,
};
const globalSettings = {
  mandatoryFields: {},
  notificationDays: 30,
  managerEmail: "manager@example.com",
  storagePath: "./storage",
  allowedEmailDomains: [],
  notificationSendHour: 7,
  emailEnabled: false,
  smtpUseTls: false,
  smtpEncryption: "starttls",
  backupEnabled: false,
  backupHour: 2,
  backupKeep: 10,
  auditLogRetentionDays: 90,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function license(overrides = {}) {
  return {
    id: 1,
    publisherName: "Acme",
    softwareDescription: "Acme Suite",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    unitPrice: "25",
    totalPoPrice: "250",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    contractNumber: "CN-1",
    poNumber: "PO-1",
    supplier: "Acme Supplier",
    costCentre: "IT",
    isRetired: false,
    documentCount: 0,
    ...overrides,
  };
}

function setupDefaultApiMocks() {
  licensesApi.getLicenses.mockResolvedValue({ data: [], error: null });
  licensesApi.getLicense.mockResolvedValue({ data: null, error: null });
  licensesApi.getCustomFieldValues.mockResolvedValue({ data: { values: [] }, error: null });
  licensesApi.getStats.mockResolvedValue({ data: { total: 0, active: 0, expiring: 0, expired: 0, renewed: 0 }, error: null });
  licensesApi.getAllCustomFieldValues.mockResolvedValue({ data: { values: [] }, error: null });
  sourcingApi.getSourcingItems.mockResolvedValue({ data: [], error: null });
  sourcingApi.getSourcingRequests.mockResolvedValue({ data: [], error: null });
  sourcingApi.createSourcingRequest.mockResolvedValue({ data: { id: 99, items: [] }, error: null });
  sourcingApi.deleteSourcingRequest.mockResolvedValue({ error: null });
  sourcingApi.exportSourcingCsv.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.getPendingOrders.mockResolvedValue({ data: [], error: null });
  pendingOrdersApi.retryPendingOrderEvidenceTransfer.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.exportPendingOrdersCsv.mockResolvedValue({ data: null, error: null });
  contractsApi.getContracts.mockResolvedValue({ data: [], error: null });
  settingsApi.listCustomFields.mockResolvedValue({ data: [], error: null });
  settingsApi.listBackups.mockResolvedValue({ data: [], error: null });
  csvImportApi.listImportMappings.mockResolvedValue({ data: [], error: null });
  usersApi.getUsers.mockResolvedValue({ data: [], error: null });
  usersApi.getDepartments.mockResolvedValue({ data: [], error: null });
  usersApi.getUserDepartments.mockResolvedValue({ data: [], error: null });
  settingsApi.updateSettings.mockResolvedValue({ data: {}, error: null });
  settingsApi.updateGlobalSettings.mockResolvedValue({ data: {}, error: null });
  pdfExport.exportFullReportPdf.mockResolvedValue();
}

function renderLicensesPage(props = {}) {
  return wrapWithQueryClient(
    <LicensesPage
      selectedId={null}
      setSelectedId={vi.fn()}
      user={admin}
      userSettings={userSettings}
      setUserSettings={vi.fn()}
      globalSettings={globalSettings}
      showError={vi.fn()}
      showSuccess={vi.fn()}
      showToast={vi.fn()}
      onStatsChange={vi.fn()}
      onPortfolioStateChange={vi.fn()}
      statsVisible
      onSetStatsVisible={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultApiMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LicensesPage workflows", () => {
  test("shows loading, empty, error, and search-filtered license rows", async () => {
    const pending = deferred();
    licensesApi.getLicenses.mockReturnValueOnce(pending.promise);
    renderLicensesPage();
    expect(await screen.findByText(/Loading licenses/i)).toBeInTheDocument();
    pending.resolve({ data: [], error: null });
    expect(await screen.findByText(/No licenses found/i)).toBeInTheDocument();
    cleanup();

    licensesApi.getLicenses.mockResolvedValueOnce({ data: null, error: "License load failed" });
    renderLicensesPage();
    expect(await screen.findByText("License load failed")).toBeInTheDocument();
    cleanup();

    licensesApi.getLicenses.mockResolvedValueOnce({
      data: [license(), license({ id: 2, publisherName: "Beta", softwareDescription: "Beta Tool" })],
      error: null,
    });
    renderLicensesPage();
    expect(await screen.findByText("Acme Suite")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Search licenses/i), "Beta");
    expect(screen.getByText("Beta Tool")).toBeInTheDocument();
    expect(screen.queryByText("Acme Suite")).not.toBeInTheDocument();
  });

  test("saves license edits from the detail panel through the update API", async () => {
    const user = userEvent.setup();
    const original = license({ startDate: "", endDate: "" });
    const updated = { ...original, softwareDescription: "Panel Edited Suite", startDate: null, endDate: null };
    licensesApi.getLicenses.mockResolvedValueOnce({ data: [original], error: null });
    licensesApi.updateLicense.mockResolvedValueOnce({ data: updated, error: null });
    licensesApi.getLicense.mockResolvedValueOnce({ data: updated, error: null });

    renderLicensesPage({ selectedId: 1 });

    await user.click(await screen.findByRole("button", { name: /^edit$/i }));
    const descriptionInput = screen.getByDisplayValue("Acme Suite");
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Panel Edited Suite");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(licensesApi.updateLicense).toHaveBeenCalledWith(1, expect.objectContaining({
        softwareDescription: "Panel Edited Suite",
        startDate: "",
        endDate: "",
      }));
    });
    expect(await screen.findAllByText("Panel Edited Suite")).not.toHaveLength(0);
  });

  test("does not send a redundant update after a single-field detail edit patch succeeds", async () => {
    const user = userEvent.setup();
    const original = license();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: [original], error: null });
    licensesApi.patchLicenseField.mockResolvedValueOnce({
      data: { ...original, publisherName: "Updated Publisher", documentCount: 0 },
      error: null,
    });

    renderLicensesPage({ selectedId: 1 });

    await user.click(await screen.findByRole("button", { name: /edit publisher/i }));
    const input = screen.getByDisplayValue("Acme");
    await user.clear(input);
    await user.type(input, "Updated Publisher");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(licensesApi.patchLicenseField).toHaveBeenCalledWith(1, "publisherName", "Updated Publisher");
    });
    expect(licensesApi.updateLicense).not.toHaveBeenCalled();
  });

  test("patches license fields from inline edit mode on the overview table", async () => {
    const user = userEvent.setup();
    const original = license();
    const updated = { ...original, publisherName: "Inline Publisher" };
    licensesApi.getLicenses.mockResolvedValueOnce({ data: [original], error: null });
    licensesApi.patchLicenseField.mockResolvedValueOnce({ data: updated, error: null });

    renderLicensesPage();

    expect(await screen.findByText("Acme Suite")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /inline edit/i }));

    const publisherInput = screen.getByLabelText(/edit publisher/i);
    await user.clear(publisherInput);
    await user.type(publisherInput, "Inline Publisher");
    fireEvent.blur(publisherInput);

    await waitFor(() => {
      expect(licensesApi.patchLicenseField).toHaveBeenCalledWith(1, "publisherName", "Inline Publisher");
    });
    expect(licensesApi.updateLicense).not.toHaveBeenCalled();
    expect(await screen.findByDisplayValue("Inline Publisher")).toBeInTheDocument();
  });
});

describe("CSVImportPage workflows", () => {
  test("handles invalid file errors, loading, preview, and import completion", async () => {
    const user = userEvent.setup();
    const onImportComplete = vi.fn();
    csvImportApi.previewCsvImport.mockResolvedValue({
      data: {
        totalRows: 1,
        activeCount: 1,
        legacyExemptCount: 0,
        legacyIncompleteCount: 0,
        errorCount: 0,
        validRows: 1,
        headersMissing: [],
        rows: [{
          rowNumber: 1,
          publisherName: "Acme",
          softwareDescription: "Imported Suite",
          importStatus: "active",
          validationErrors: [],
          warnings: [],
          duplicateWarnings: [],
        }],
      },
      error: null,
    });
    csvImportApi.confirmCsvImport.mockResolvedValue({
      data: { importedCount: 1, skippedCount: 0, errors: [] },
      error: null,
    });

    const { container } = render(<CSVImportPage onImportComplete={onImportComplete} />);
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, {
      target: { files: [new File(["nope"], "not-a-csv.txt", { type: "text/plain" })] },
    });
    expect(screen.getByText(/Please select a CSV file/i)).toBeInTheDocument();
    cleanup();

    const pending = deferred();
    csvImportApi.previewCsvImport.mockReturnValueOnce(pending.promise);
    const loadingRender = render(<CSVImportPage onImportComplete={onImportComplete} />);
    const loadingInput = loadingRender.container.querySelector('input[type="file"]');
    fireEvent.change(loadingInput, {
      target: { files: [new File(["publisher"], "licenses.csv", { type: "text/csv" })] },
    });
    expect(await screen.findByText(/Analysing CSV/i)).toBeInTheDocument();
    pending.resolve({
      data: {
        totalRows: 0,
        activeCount: 0,
        legacyExemptCount: 0,
        legacyIncompleteCount: 0,
        errorCount: 0,
        validRows: 0,
        headersMissing: [],
        rows: [],
      },
      error: null,
    });
    expect(await screen.findByText(/0 will import/i)).toBeInTheDocument();
    cleanup();

    render(<CSVImportPage onImportComplete={onImportComplete} />);
    const happyInput = document.querySelector('input[type="file"]');
    fireEvent.change(happyInput, {
      target: { files: [new File(["publisher"], "happy.csv", { type: "text/csv" })] },
    });
    expect(await screen.findByText("Imported Suite")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Import 1 license/i }));
    expect(await screen.findByText(/Import complete/i)).toBeInTheDocument();
    expect(onImportComplete).toHaveBeenCalled();
  });
});

describe("SettingsPage workflows", () => {
  test("groups admin settings into general, integrations, and operations", async () => {
    const user = userEvent.setup();

    render(
      <SettingsPage
        userSettings={userSettings}
        setUserSettings={vi.fn()}
        globalSettings={globalSettings}
        setGlobalSettings={vi.fn()}
        user={admin}
        onError={vi.fn()}
        onToast={vi.fn()}
        _adminOnly
      />
    );

    expect(screen.getByRole("button", { name: /Document Storage/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /API Tokens/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Integrations/i }));
    expect(screen.getByRole("button", { name: /API Tokens/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Webhooks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Extensions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plugins/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Database Backup Scheduled/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Operations/i }));
    expect(screen.getByRole("button", { name: /^Database Backup Scheduled/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Restore Database/i }).length).toBeGreaterThan(0);
  });

  test("saves appearance settings and reports API errors through toast callbacks", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const onError = vi.fn();
    const setUserSettings = vi.fn((updater) => updater(userSettings));

    render(
      <SettingsPage
        userSettings={userSettings}
        setUserSettings={setUserSettings}
        globalSettings={globalSettings}
        setGlobalSettings={vi.fn()}
        user={admin}
        onError={onError}
        onToast={onToast}
        _mySettingsOnly
      />
    );
    await user.click(screen.getByRole("button", { name: /Appearance/i }));
    await user.selectOptions(screen.getByLabelText(/Theme/i), "dark");
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));
    await waitFor(() => expect(settingsApi.updateSettings).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith("Settings saved.", "info");

    settingsApi.updateSettings.mockResolvedValueOnce({ data: null, error: "Settings failed" });
    await user.click(screen.getByRole("button", { name: /Appearance/i }));
    await user.selectOptions(screen.getByLabelText(/Theme/i), "light");
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Settings failed"));
  });

  test("saves admin notification settings with cleared allowed domains", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const initialGlobalState = {
      ...globalSettings,
      allowedEmailDomains: ["example.com"],
      notificationDays: 30,
    };
    settingsApi.updateGlobalSettings.mockResolvedValueOnce({
      data: {
        notification_days: 45,
        manager_email: "manager@example.com",
        notification_send_hour: 7,
        allowed_email_domains: "",
      },
      error: null,
    });

    function Harness() {
      const [state, setState] = React.useState(initialGlobalState);
      return (
        <SettingsPage
          userSettings={userSettings}
          setUserSettings={vi.fn()}
          globalSettings={state}
          setGlobalSettings={setState}
          user={admin}
          onError={vi.fn()}
          onToast={onToast}
          _adminOnly
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getAllByRole("button", { name: /Notifications/i })[0]);
    fireEvent.change(screen.getByLabelText(/Alert Window/i), { target: { value: "45" } });
    await user.click(screen.getByTitle("Remove example.com"));
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));

    await waitFor(() => {
      expect(settingsApi.updateGlobalSettings).toHaveBeenCalledWith(expect.objectContaining({
        notification_days: 45,
        allowed_email_domains: "",
      }));
    });
    expect(onToast).toHaveBeenCalledWith("Settings saved.", "info");
  });

  test("saves SMTP settings with the existing backend payload shape", async () => {
    const user = userEvent.setup();
    const initialGlobalState = {
      ...globalSettings,
      emailEnabled: true,
      smtpHost: "smtp.old.example.com",
      smtpPort: 587,
      smtpUsername: "old-user",
      smtpPassword: "old-secret",
      smtpSender: "Licenses <old@example.com>",
      smtpUseTls: false,
      smtpEncryption: "starttls",
    };

    function Harness() {
      const [state, setState] = React.useState(initialGlobalState);
      return (
        <SettingsPage
          userSettings={userSettings}
          setUserSettings={vi.fn()}
          globalSettings={state}
          setGlobalSettings={setState}
          user={admin}
          onError={vi.fn()}
          onToast={vi.fn()}
          _adminOnly
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Email Configuration/i }));
    fireEvent.change(screen.getByLabelText(/SMTP Host/i), { target: { value: "smtp.new.example.com" } });
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));

    await waitFor(() => {
      expect(settingsApi.updateGlobalSettings).toHaveBeenCalledWith({
        email_enabled: true,
        smtp_host: "smtp.new.example.com",
        smtp_port: 587,
        smtp_username: "old-user",
        smtp_password: "old-secret",
        smtp_sender: "Licenses <old@example.com>",
        smtp_use_tls: false,
        smtp_encryption: "starttls",
      });
    });
  });

  test("saves OIDC and database backup settings with focused section payloads", async () => {
    const user = userEvent.setup();
    const initialGlobalState = {
      ...globalSettings,
      oidcEnabled: true,
      oidcDiscoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
      oidcClientId: "license-track",
      oidcClientSecret: "existing-secret",
      backupLocation: "./backups",
      backupEnabled: true,
      backupHour: 2,
      backupKeep: 10,
      auditLogRetentionDays: 90,
    };

    function Harness() {
      const [state, setState] = React.useState(initialGlobalState);
      return (
        <SettingsPage
          userSettings={userSettings}
          setUserSettings={vi.fn()}
          globalSettings={state}
          setGlobalSettings={setState}
          user={admin}
          onError={vi.fn()}
          onToast={vi.fn()}
          _adminOnly
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /SSO \/ OIDC/i }));
    fireEvent.change(screen.getByLabelText(/Discovery URL/i), {
      target: { value: "https://login.example.com/.well-known/openid-configuration" },
    });
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));

    await waitFor(() => {
      expect(settingsApi.updateGlobalSettings).toHaveBeenLastCalledWith({
        oidc_enabled: true,
        oidc_discovery_url: "https://login.example.com/.well-known/openid-configuration",
        oidc_client_id: "license-track",
        oidc_client_secret: "existing-secret",
      });
    });

    await user.click(screen.getByRole("button", { name: /Operations/i }));
    await user.click(screen.getByRole("button", { name: /^Database Backup Scheduled/i }));
    fireEvent.change(screen.getByLabelText(/Keep \(number of database backups\)/i), { target: { value: "14" } });
    await user.click(screen.getAllByRole("button", { name: /^Save$/i }).find((button) => !button.disabled));

    await waitFor(() => {
      expect(settingsApi.updateGlobalSettings).toHaveBeenLastCalledWith({
        backup_location: "./backups",
        backup_enabled: true,
        backup_hour: 2,
        backup_keep: 14,
        audit_log_retention_days: 90,
      });
    });
  });
});

describe("UsersPage workflows", () => {
  test("shows loading, handles load errors, and creates a user", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const pending = deferred();
    usersApi.getUsers.mockReturnValueOnce(pending.promise);
    render(<UsersPage currentUserId={1} onError={onError} onToast={vi.fn()} />);
    expect(await screen.findByText(/Loading users/i)).toBeInTheDocument();
    pending.resolve({ data: [], error: null });
    expect(await screen.findByText(/Add New User/i)).toBeInTheDocument();
    cleanup();

    usersApi.getUsers.mockResolvedValueOnce({ data: null, error: "Users failed" });
    render(<UsersPage currentUserId={1} onError={onError} onToast={vi.fn()} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Users failed"));
    cleanup();

    usersApi.createUser.mockResolvedValueOnce({
      data: { id: 9, username: "newuser", email: "new@example.com", role: "viewer", authProvider: "local", isActive: true },
      error: null,
    });
    render(<UsersPage currentUserId={1} onError={onError} onToast={vi.fn()} />);
    await screen.findByText(/Add New User/i);
    await user.type(screen.getByPlaceholderText("username"), "newuser");
    await user.type(screen.getByPlaceholderText("user@example.com"), "new@example.com");
    await user.type(screen.getByPlaceholderText("••••••••"), "password123");
    await user.click(screen.getByRole("button", { name: /Add User/i }));
    expect(await screen.findByText("newuser")).toBeInTheDocument();
    expect(usersApi.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: "newuser" }));
  });

  test("reports department assignment failures instead of silently completing user saves", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    usersApi.getUsers.mockResolvedValueOnce({
      data: [{
        id: 4,
        username: "viewer1",
        email: "viewer@example.com",
        role: "viewer",
        auth_provider: "local",
        allow_downloads: true,
        is_active: true,
      }],
      error: null,
    });
    usersApi.getDepartments.mockResolvedValueOnce({ data: ["IT"], error: null });
    usersApi.getUserDepartments.mockResolvedValueOnce({ data: ["IT"], error: null });
    usersApi.updateUser.mockResolvedValueOnce({
      data: {
        id: 4,
        username: "viewer1",
        email: "viewer@example.com",
        role: "viewer",
        auth_provider: "local",
        allow_downloads: true,
        is_active: true,
      },
      error: null,
    });
    usersApi.updateUserDepartments.mockResolvedValueOnce({ data: null, error: "Department update failed" });

    render(<UsersPage currentUserId={1} onError={onError} onToast={vi.fn()} />);

    expect(await screen.findByText("viewer1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(usersApi.updateUser).toHaveBeenCalledWith(4, expect.objectContaining({ role: "viewer" }));
      expect(usersApi.updateUserDepartments).toHaveBeenCalledWith(4, ["IT"]);
      expect(onError).toHaveBeenCalledWith("Department update failed");
    });
  });
});

describe("ContractsPage workflows", () => {
  test("covers loading, empty, error, and opening a contract", async () => {
    const pending = deferred();
    contractsApi.getContracts.mockReturnValueOnce(pending.promise);
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />);
    expect(await screen.findByText(/Loading contracts/i)).toBeInTheDocument();
    pending.resolve({ data: [], error: null });
    expect(await screen.findByText(/No contracts yet/i)).toBeInTheDocument();
    cleanup();

    const showError = vi.fn();
    contractsApi.getContracts.mockResolvedValueOnce({ data: null, error: "Contracts failed" });
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={showError} />);
    await waitFor(() => expect(showError).toHaveBeenCalledWith("Contracts failed"));
    cleanup();

    contractsApi.getContracts.mockResolvedValue({
      data: [{ id: 4, publisherName: "Acme", contractNumber: "CN-4", licenseCount: 1, documentCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /Open contract CN-4/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Contract 4 opened");
  });

  test("validates required fields in the new contract modal before creating", async () => {
    const user = userEvent.setup();
    const showError = vi.fn();
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={showError} />);

    await user.click(await screen.findByRole("button", { name: /New Contract/i }));
    expect(screen.getByRole("dialog", { name: /New Contract/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Create Contract/i }));

    expect(showError).toHaveBeenCalledWith("Contract number and publisher name are required.");
    expect(contractsApi.createContract).not.toHaveBeenCalled();
  });

  test("creates a new contract with the existing payload shape", async () => {
    const user = userEvent.setup();
    contractsApi.createContract.mockResolvedValueOnce({
      data: { id: 11, publisherName: "Acme Corp", contractNumber: "CN-100", licenseCount: 0, documentCount: 0 },
      error: null,
    });
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /New Contract/i }));
    // Set field values atomically — per-character user.type() can drop input under
    // in-file load, leaving required fields empty and blocking the submit.
    fireEvent.change(screen.getByLabelText(/Contract Number/i), { target: { value: "  CN-100  " } });
    fireEvent.change(screen.getByLabelText(/Publisher Name/i), { target: { value: "  Acme Corp  " } });
    fireEvent.change(screen.getByLabelText(/Notes/i), { target: { value: "  Renewal baseline  " } });
    await user.click(screen.getByRole("button", { name: /Create Contract/i }));

    await waitFor(() => expect(contractsApi.createContract).toHaveBeenCalledWith({
      contract_number: "CN-100",
      publisher_name: "Acme Corp",
      notes: "Renewal baseline",
    }));
    expect(await screen.findByText("Contract 11 opened")).toBeInTheDocument();
  });

  test("closes the new contract modal from cancel, close, and overlay clicks", async () => {
    const user = userEvent.setup();
    wrapWithQueryClient(<ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /New Contract/i }));
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByRole("dialog", { name: /New Contract/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New Contract/i }));
    await user.click(screen.getByRole("button", { name: /Close/i }));
    expect(screen.queryByRole("dialog", { name: /New Contract/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New Contract/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /New Contract/i }).parentElement);
    expect(screen.queryByRole("dialog", { name: /New Contract/i })).not.toBeInTheDocument();
  });
});

describe("SourcingPage workflows", () => {
  // mergeItems are request objects (with nested items) matching the new API shape
  const mergeItems = [
    {
      id: 1,
      supplier: "Acme Corp",
      contactEmail: null,
      createdAt: "2026-01-01T00:00:00Z",
      quoteDocuments: [],
      items: [
        { id: 11, publisherName: "Acme", softwareDescription: "Acme Renewal A", quantity: "2", currency: "EUR", isRenewal: true, renewalForLicenseId: 101 },
        { id: 12, publisherName: "Acme", softwareDescription: "Acme Renewal B", quantity: "3", currency: "EUR", isRenewal: true, renewalForLicenseId: 102 },
      ],
    },
  ];

  test("covers loading, empty, error toast, search, and adding an item", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    sourcingApi.getSourcingRequests.mockReturnValueOnce(pending.promise);
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);
    expect(await screen.findByText(/Loading sourcing items/i)).toBeInTheDocument();
    pending.resolve({ data: [], error: null });
    expect(await screen.findByText(/No sourcing requests yet/i)).toBeInTheDocument();
    cleanup();

    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: null, error: "Sourcing failed" });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);
    expect(await screen.findByText("Sourcing failed")).toBeInTheDocument();
    cleanup();

    const request1 = {
      id: 1,
      supplier: "Acme Supplier",
      contactEmail: null,
      createdAt: "2026-01-01T00:00:00Z",
      quoteDocuments: [],
      items: [{ id: 10, publisherName: "Acme", softwareDescription: "Acme Trial", quantity: "5", currency: "EUR", isRenewal: false }],
    };
    const request2 = {
      id: 2,
      supplier: null,
      contactEmail: null,
      createdAt: "2026-01-02T00:00:00Z",
      quoteDocuments: [],
      items: [{ id: 20, publisherName: "Created Publisher", softwareDescription: "Created Sourcing App", quantity: "3", currency: "EUR", isRenewal: false }],
    };
    sourcingApi.getSourcingRequests
      .mockResolvedValueOnce({ data: [request1], error: null })
      .mockResolvedValueOnce({ data: [request1, request2], error: null });
    sourcingApi.createSourcingRequest.mockResolvedValueOnce({ data: { id: 2, items: [] }, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);
    expect(await screen.findByText("Acme Supplier")).toBeInTheDocument();
    await user.click(screen.getByText("Acme Supplier"));
    expect(screen.getByText("Acme Trial")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search sourcing requests/i), "nothing");
    expect(screen.getByText(/No requests match your search\./i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Search sourcing requests/i));
    await user.click(screen.getByRole("button", { name: /Add Request/i }));
    await user.click(screen.getByRole("button", { name: /Save sourcing item/i }));
    expect(await screen.findByText("Created Sourcing App")).toBeInTheDocument();
  });

  test("merge modal opens and cancel, close, and overlay dismiss it when not merging", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    await user.click(screen.getByText("Acme Corp"));
    expect(screen.getByText("Acme Renewal A")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));
    expect(screen.getByRole("dialog", { name: /merge renewal sourcing items/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /merge renewal sourcing items/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog", { name: /merge renewal sourcing items/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /merge renewal sourcing items/i }).parentElement);
    expect(screen.queryByRole("dialog", { name: /merge renewal sourcing items/i })).not.toBeInTheDocument();
  });

  test("merge confirm calls mergeSourcingItems with selected ids and patches changed target quantity", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    sourcingApi.updateSourcingItem.mockResolvedValueOnce({ data: { id: 99, quantity: "9" }, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    await user.click(screen.getByText("Acme Corp"));
    expect(screen.getByText("Acme Renewal A")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));

    const dialog = screen.getByRole("dialog", { name: /merge renewal sourcing items/i });
    const quantityInput = within(dialog).getByDisplayValue("5");
    await user.clear(quantityInput);
    await user.type(quantityInput, "9");
    await user.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    await waitFor(() => {
      expect(sourcingApi.mergeSourcingItems).toHaveBeenCalledWith([11, 12]);
      expect(sourcingApi.updateSourcingItem).toHaveBeenCalledWith(99, { quantity: "9" });
    });
  });

  test("merge modal cannot close while merging", async () => {
    const user = userEvent.setup();
    const pendingMerge = deferred();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockReturnValueOnce(pendingMerge.promise);
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    await user.click(screen.getByText("Acme Corp"));
    expect(screen.getByText("Acme Renewal A")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));
    await user.click(screen.getByRole("button", { name: /^merge$/i }));

    const dialog = screen.getByRole("dialog", { name: /merge renewal sourcing items/i });
    expect(within(dialog).getByRole("button", { name: /^cancel$/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^close$/i })).toBeDisabled();

    fireEvent.click(dialog.parentElement);
    expect(screen.getByRole("dialog", { name: /merge renewal sourcing items/i })).toBeInTheDocument();

    pendingMerge.resolve({ data: { id: 99 }, error: null });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /merge renewal sourcing items/i })).not.toBeInTheDocument();
    });
  });

  test("delete confirmation opens, cancels, and confirms with the same sourcing id", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{ id: 7, supplier: "Delete Me Supplier", contactEmail: null, createdAt: "2026-01-01T00:00:00Z", quoteDocuments: [], items: [] }],
      error: null,
    });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Delete Me Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    let dialog = screen.getByRole("dialog", { name: /delete sourcing request/i });
    expect(dialog).toHaveTextContent("Are you sure you want to delete this sourcing request");

    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /delete sourcing request/i })).not.toBeInTheDocument();
    expect(sourcingApi.deleteSourcingRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    dialog = screen.getByRole("dialog", { name: /delete sourcing request/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(sourcingApi.deleteSourcingRequest).toHaveBeenCalledWith(7);
      expect(screen.queryByText("Delete Me Supplier")).not.toBeInTheDocument();
    });
  });
});

describe("PendingOrdersPage workflows", () => {
  test("covers loading, empty, error callback, search, and adding a PO", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const showError = vi.fn();
    pendingOrdersApi.getPendingOrders.mockReturnValueOnce(pending.promise);
    wrapWithQueryClient(<PendingOrdersPage user={admin} userSettings={userSettings} showError={showError} showSuccess={vi.fn()} />);
    expect(pendingOrdersApi.getPendingOrders).toHaveBeenCalledWith({ includeEvidenceIssues: true });
    expect(await screen.findByText(/Loading pending orders/i)).toBeInTheDocument();
    pending.resolve({ data: [], error: null });
    expect(await screen.findByText(/No pending orders yet/i)).toBeInTheDocument();
    cleanup();

    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: null, error: "PO failed" });
    wrapWithQueryClient(<PendingOrdersPage user={admin} userSettings={userSettings} showError={showError} showSuccess={vi.fn()} />);
    await waitFor(() => expect(showError).toHaveBeenCalledWith("PO failed"));
    cleanup();

    const poOne = { id: 1, poNumber: "PO-1", supplier: "Acme Supplier", status: "pending", items: [], createdAt: "2026-01-01T00:00:00Z" };
    const poNew = { id: 2, poNumber: "PO-NEW", supplier: "Created Supplier", status: "pending", items: [], createdAt: "2026-01-02T00:00:00Z" };
    // Initial load returns PO-1; the post-create invalidate refetch returns both
    // (handleCreatePendingOrder renders via refetch, not optimistic insert).
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [poOne], error: null });
    pendingOrdersApi.getPendingOrders.mockResolvedValue({ data: [poOne, poNew], error: null });
    pendingOrdersApi.createPendingOrder.mockResolvedValueOnce({ data: poNew, error: null });
    wrapWithQueryClient(<PendingOrdersPage user={admin} userSettings={userSettings} showError={showError} showSuccess={vi.fn()} />);
    expect(await screen.findByText("PO-1")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search pending orders/i), "missing");
    expect(screen.getByText(/No orders match your search/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Search pending orders/i));
    await user.click(screen.getByRole("button", { name: /Add PO/i }));
    await user.click(screen.getByRole("button", { name: /Save pending order/i }));
    expect(await screen.findByText("PO-NEW")).toBeInTheDocument();
  });

  test("delete confirmation opens, cancels, and confirms with the same pending order id", async () => {
    const user = userEvent.setup();
    const onPortfolioStateChange = vi.fn();
    const onRenewalsReload = vi.fn();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{ id: 9, poNumber: "PO-DELETE", supplier: "Delete Supplier", status: "pending", items: [], createdAt: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    pendingOrdersApi.deletePendingOrder.mockResolvedValueOnce({ error: null });
    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
        onPortfolioStateChange={onPortfolioStateChange}
        onRenewalsReload={onRenewalsReload}
      />
    );

    expect(await screen.findByText("PO-DELETE")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    let dialog = screen.getByRole("dialog", { name: /delete pending order/i });
    expect(dialog).toHaveTextContent("Are you sure you want to delete this pending order? Associated sourcing items will not be deleted.");

    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /delete pending order/i })).not.toBeInTheDocument();
    expect(pendingOrdersApi.deletePendingOrder).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    dialog = screen.getByRole("dialog", { name: /delete pending order/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.deletePendingOrder).toHaveBeenCalledWith(9);
      expect(screen.queryByText("PO-DELETE")).not.toBeInTheDocument();
    });
    expect(onPortfolioStateChange).toHaveBeenCalled();
    expect(onRenewalsReload).toHaveBeenCalled();
  });

  test("surfaces retry for converted pending orders with failed evidence transfer", async () => {
    const user = userEvent.setup();
    const showSuccess = vi.fn();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{
        id: 12,
        poNumber: "PO-EVIDENCE",
        supplier: "Evidence Supplier",
        status: "converted",
        evidenceTransferStatus: "failed",
        evidenceTransferDetail: "storage failed",
        items: [],
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });
    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={showSuccess}
      />
    );

    expect(await screen.findByText("Evidence Failed")).toBeInTheDocument();
    expect(screen.getByText("storage failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Retry Evidence/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.retryPendingOrderEvidenceTransfer).toHaveBeenCalledWith(12);
      expect(showSuccess).toHaveBeenCalledWith("Evidence transfer retry started.");
    });
  });
});

describe("ReportsPage workflows", () => {
  test("renders empty reports, happy-path report data, and export errors", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    wrapWithQueryClient(<ReportsPage userSettings={userSettings} onError={onError} />);
    expect(await screen.findAllByText(/No data available for the current filters/i)).not.toHaveLength(0);
    cleanup();

    licensesApi.getLicenses.mockResolvedValueOnce({
      data: [
        license({
          id: 1,
          publisherName: "Report Publisher",
          supplier: "Report Supplier",
          endDate: "2026-10-01",
          budgetOwnerEmail: "budget@example.com",
        }),
        license({
          id: 2,
          publisherName: "Paid Perpetual",
          licenseType: "perpetual",
          softwareDescription: "Paid once",
          totalPoPrice: "5000",
          quantity: "1",
          unitPrice: "5000",
          poNumber: "PO-2",
          hasMaintenance: true,
          activeMaintenanceId: 3,
        }),
        license({
          id: 3,
          publisherName: "Maintenance Publisher",
          licenseType: "maintenance",
          softwareDescription: "Annual support",
          totalPoPrice: "5000",
          quantity: "1",
          unitPrice: "600",
          poNumber: "PO-2",
          parentLicenseId: 2,
          budgetOwnerEmail: "maintenance@example.com",
        }),
      ],
      error: null,
    });
    wrapWithQueryClient(<ReportsPage userSettings={userSettings} onError={onError} />);
    expect(await screen.findAllByText("Report Publisher")).not.toHaveLength(0);
    expect(screen.getByText(/Showing 3 licenses/i)).toBeInTheDocument();
    expect(screen.getByText("Cost Overview & Forecast")).toBeInTheDocument();
    expect(screen.getByText(/2 active recurring records/i)).toBeInTheDocument();
    expect(screen.getByText("maintenance@example.com")).toBeInTheDocument();

    pdfExport.exportFullReportPdf.mockRejectedValueOnce(new Error("PDF failed"));
    await user.click(screen.getAllByRole("button", { name: /Export Full Report/i }).at(-1));
    expect(pdfExport.exportFullReportPdf).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ elementId: "report-section-cost-forecast" }),
      ]),
      "license-lifecycle-full-report",
      expect.anything()
    );
    await waitFor(() => expect(onError).toHaveBeenCalledWith("PDF export failed — try again"));
  });
});

describe("NotificationsPage workflows", () => {
  test("renders empty and happy notification states and navigates from a row", async () => {
    const setSelectedId = vi.fn();
    const setPage = vi.fn();
    render(
      <NotificationsPage
        notifications={[]}
        globalSettings={globalSettings}
        setSelectedId={setSelectedId}
        setPage={setPage}
      />
    );
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();

    licensesApi.getLicenses.mockResolvedValueOnce({
      data: [license({ id: 7, budgetOwnerEmail: "owner@example.com" })],
      error: null,
    });
    render(
      <NotificationsPage
        notifications={[{
          license_id: 7,
          publisher: "Acme",
          software_name: "Renewal Suite",
          type: "expiring",
          detail: "Expires in 5 days",
        }]}
        globalSettings={globalSettings}
        setSelectedId={setSelectedId}
        setPage={setPage}
      />
    );
    const row = await screen.findByRole("button", { name: /View license/i });
    expect(row).toHaveTextContent("Renewal Suite");
    await userEvent.click(row);
    expect(setSelectedId).toHaveBeenCalledWith(7);
    expect(setPage).toHaveBeenCalledWith("licenses");
  });
});

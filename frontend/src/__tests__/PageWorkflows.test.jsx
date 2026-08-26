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
import { queryKeys } from "../queryKeys.js";

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
  getLicenseProcurementTrail: vi.fn().mockResolvedValue({ data: null, error: null }),
  updateLicense: vi.fn(),
  patchLicenseField: vi.fn(),
  deleteLicense: vi.fn(),
  bulkDeleteLicenses: vi.fn(),
  getStats: vi.fn(),
  initiateRenewal: vi.fn(),
  initiateRenewalBundle: vi.fn(),
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
  restoreServerBackup: vi.fn(),
  previewPortfolioReset: vi.fn(),
  resetPortfolio: vi.fn(),
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
  cancelSourcingRequest: vi.fn(),
  getSourcingItems: vi.fn(),
  getSourcingRequestHistory: vi.fn(),
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
  convertFreewareSourcingItem: vi.fn(),
  convertFreewareSourcingRequest: vi.fn(),
  mergeSourcingItems: vi.fn(),
  uploadSourcingQuoteDocument: vi.fn(),
  downloadSourcingQuoteDocument: vi.fn(),
  deleteSourcingQuoteDocument: vi.fn(),
  exportSourcingCsv: vi.fn(),
}));

vi.mock("../api/pendingOrders.js", () => ({
  addItemsToPendingOrderBulk: vi.fn(),
  cancelPendingOrder: vi.fn(),
  deletePendingOrderItem: vi.fn(),
  getPendingOrders: vi.fn(),
  getPendingOrderHistory: vi.fn(),
  getPendingOrder: vi.fn(),
  createPendingOrder: vi.fn(),
  updatePendingOrder: vi.fn(),
  deletePendingOrder: vi.fn(),
  updatePendingOrderItem: vi.fn(),
  uploadPendingOrderDocument: vi.fn(),
  downloadPendingOrderDocument: vi.fn(),
  deletePendingOrderDocument: vi.fn(),
  convertPendingOrder: vi.fn(),
  batchConvertPendingOrder: vi.fn(),
  retryPendingOrderEvidenceTransfer: vi.fn(),
  exportPendingOrdersCsv: vi.fn(),
}));

vi.mock("../utils/pdfExport.js", () => ({
  exportFullReportPdf: vi.fn(),
}));

vi.mock("../components/contracts/ContractModal.jsx", () => ({
  default: ({ contractId, onChanged }) => (
    <div role="dialog">
      Contract {contractId} opened
      <button type="button" onClick={onChanged}>Simulate contract change</button>
    </div>
  ),
}));

vi.mock("../components/procurement/SourcingItemModal.jsx", () => ({
  default: ({ item, sourcingRequest, onSave, onCancel }) => (
    <form
      role="dialog"
      aria-label="Sourcing item form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSave({
          publisherName: "Created Publisher",
          softwareDescription: "Created Sourcing App",
          quantity: "3",
          currency: "EUR",
          startDate: item?.startDate,
          endDate: item?.endDate,
          supplier: formData.get("supplier"),
          ...(formData.get("maintenanceCompanion") === "on" ? {
            maintenanceCompanion: {
              publisherName: "Created Publisher",
              softwareDescription: "Created Sourcing App maintenance/support",
              licenseType: "maintenance",
              quantity: "3",
              currency: "EUR",
              supplier: formData.get("supportSupplier") || null,
              parentSourcingItemId: item?.id ?? null,
            },
          } : {}),
        });
      }}
    >
      <label>
        Request supplier
        <input
          name="supplier"
          defaultValue={item?.supplier ?? sourcingRequest?.supplier ?? ""}
        />
      </label>
      <label>
        Add maintenance companion
        <input type="checkbox" name="maintenanceCompanion" />
      </label>
      <label>
        Support supplier
        <input name="supportSupplier" />
      </label>
      <button type="submit">Save sourcing item</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  ),
}));

vi.mock("../components/procurement/PendingOrderModal.jsx", () => ({
  default: ({ onSave, onCancel }) => (
    <div role="dialog" aria-label="Pending order form">
      <button onClick={() => onSave({ poNumber: "PO-NEW", procurementReference: "", supplier: "Created Supplier", notes: "" })}>
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
  sourcingApi.updateSourcingItem.mockReset();
  sourcingApi.mergeSourcingItems.mockReset();
  licensesApi.getLicenses.mockResolvedValue({ data: [], error: null });
  licensesApi.getLicense.mockResolvedValue({ data: null, error: null });
  licensesApi.getCustomFieldValues.mockResolvedValue({ data: { values: [] }, error: null });
  licensesApi.getStats.mockResolvedValue({ data: { total: 0, active: 0, expiring: 0, expired: 0, renewed: 0 }, error: null });
  licensesApi.getAllCustomFieldValues.mockResolvedValue({ data: { values: [] }, error: null });
  sourcingApi.getSourcingItems.mockResolvedValue({ data: [], error: null });
  sourcingApi.getSourcingRequestHistory.mockResolvedValue({ data: [], error: null });
  sourcingApi.getSourcingRequests.mockResolvedValue({ data: [], error: null });
  sourcingApi.cancelSourcingRequest.mockResolvedValue({ error: null });
  sourcingApi.convertFreewareSourcingItem.mockResolvedValue({ data: null, error: null });
  sourcingApi.convertFreewareSourcingRequest.mockResolvedValue({ data: [], error: null });
  sourcingApi.createSourcingRequest.mockResolvedValue({ data: { id: 99, items: [] }, error: null });
  sourcingApi.addSourcingRequestItem.mockResolvedValue({ data: { id: 99, items: [] }, error: null });
  sourcingApi.deleteSourcingRequest.mockResolvedValue({ error: null });
  sourcingApi.uploadSourcingQuoteDocument.mockResolvedValue({ data: null, error: null });
  sourcingApi.downloadSourcingQuoteDocument.mockResolvedValue({ data: null, error: null });
  sourcingApi.deleteSourcingQuoteDocument.mockResolvedValue({ error: null });
  sourcingApi.exportSourcingCsv.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.getPendingOrders.mockResolvedValue({ data: [], error: null });
  pendingOrdersApi.getPendingOrderHistory.mockResolvedValue({ data: [], error: null });
  pendingOrdersApi.cancelPendingOrder.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.downloadPendingOrderDocument.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.deletePendingOrderDocument.mockResolvedValue({ error: null });
  pendingOrdersApi.retryPendingOrderEvidenceTransfer.mockResolvedValue({ data: null, error: null });
  pendingOrdersApi.exportPendingOrdersCsv.mockResolvedValue({ data: null, error: null });
  contractsApi.getContracts.mockResolvedValue({ data: [], error: null });
  settingsApi.listCustomFields.mockResolvedValue({ data: [], error: null });
  settingsApi.listBackups.mockResolvedValue({ data: [], error: null });
  settingsApi.previewPortfolioReset.mockResolvedValue({
    data: {
      counts: {
        licenses: 0,
        sourcing_requests: 0,
        sourcing_items: 0,
        pending_orders: 0,
        contracts: 0,
        documents: 0,
        audit_events: 0,
      },
      confirmation: "RESET PORTFOLIO",
      next_license_ref: "LT-REF-00001",
    },
    error: null,
  });
  settingsApi.resetPortfolio.mockResolvedValue({
    data: {
      status: "completed",
      archive_filename: "license_lifecycle_pre_portfolio_reset_test.zip",
      storage_cleanup_failed: false,
      next_license_ref: "LT-REF-00001",
    },
    error: null,
  });
  settingsApi.restoreServerBackup.mockResolvedValue({
    data: {
      status: "restore_initiated",
      restart_scheduled: true,
      archive_type: "portfolio_reset_recovery",
      restored_documents: true,
    },
    error: null,
  });
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

  test("keeps table headers and column filters available when no licenses match", async () => {
    const user = userEvent.setup();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: [license()], error: null });

    renderLicensesPage();

    expect(await screen.findByText("Acme Suite")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show column filters/i }));
    await user.click(screen.getByRole("button", { name: "Type" }));
    await user.click(screen.getByLabelText("Maintenance"));

    expect(await screen.findByText("No licenses found")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 selected" })).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  test("renders licenses when the shared licenses cache contains the legacy array shape", async () => {
    const cachedLicenses = Array.from({ length: 5 }, (_, index) => license({
      id: index + 1,
      publisherName: `Cached Publisher ${index + 1}`,
      softwareDescription: `Cached App ${index + 1}`,
    }));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.licenses, cachedLicenses);
    licensesApi.getLicenses.mockResolvedValueOnce({ data: cachedLicenses, error: null });
    licensesApi.getStats.mockResolvedValueOnce({
      data: {
        total: 5,
        total_active: 5,
        total_expiring: 0,
        total_expired: 0,
        total_legacy: 4,
        annual_cost_by_currency: {},
        excluded_from_totals: 0,
      },
      error: null,
    });

    render(
      <QueryClientProvider client={queryClient}>
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
        />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Cached App 1")).toBeInTheDocument();
    expect(screen.queryByText(/-4 licenses tracked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No licenses found/i)).not.toBeInTheDocument();
    cleanup();
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
    expect(licensesApi.getLicenses).toHaveBeenCalledWith({ includeRetired: false });
    expect(licensesApi.getLicenses.mock.calls.length).toBeGreaterThanOrEqual(2);
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
    expect(screen.queryByRole("button", { name: /Official Extensions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Database Backup Scheduled/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Operations/i }));
    expect(screen.getByRole("button", { name: /^Database Backup Scheduled/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Restore Database/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Reset Portfolio Data/i }).length).toBeGreaterThan(0);
  });

  test("requires the typed phrase before resetting the complete portfolio", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const onPortfolioReset = vi.fn();

    render(
      <SettingsPage
        userSettings={userSettings}
        setUserSettings={vi.fn()}
        globalSettings={globalSettings}
        setGlobalSettings={vi.fn()}
        user={admin}
        onError={vi.fn()}
        onToast={onToast}
        onPortfolioReset={onPortfolioReset}
        _adminOnly
      />
    );

    await user.click(screen.getByRole("button", { name: /Operations/i }));
    await user.click(screen.getByRole("button", { name: /Reset Portfolio Data Start/i }));
    await user.click(screen.getByRole("button", { name: /Review Portfolio Reset/i }));

    expect(await screen.findByText(/including completed and cancelled history/i)).toBeInTheDocument();
    const resetButton = screen.getByRole("button", { name: /^Reset Portfolio Data$/i });
    expect(resetButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Type RESET PORTFOLIO to confirm/i), "RESET PORTFOLIO");
    expect(resetButton).toBeEnabled();
    await user.click(resetButton);

    await waitFor(() => {
      expect(settingsApi.resetPortfolio).toHaveBeenCalledWith("RESET PORTFOLIO");
    });
    expect(onPortfolioReset).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("license_lifecycle_pre_portfolio_reset_test.zip"),
      "success",
    );
  });

  test("restores a selected server archive while keeping file upload available", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    settingsApi.listBackups.mockResolvedValue({
      data: [
        {
          filename: "license_lifecycle_pre_portfolio_reset_20260724.zip",
          size_bytes: 2048,
          created_at: 1784880000,
          archive_type: "portfolio_reset_recovery",
          includes_documents: true,
        },
        {
          filename: "license_lifecycle_backup_20260723.zip",
          size_bytes: 1024,
          created_at: 1784793600,
          archive_type: "database_backup",
          includes_documents: false,
        },
      ],
      error: null,
    });

    render(
      <SettingsPage
        userSettings={userSettings}
        setUserSettings={vi.fn()}
        globalSettings={globalSettings}
        setGlobalSettings={vi.fn()}
        user={admin}
        onError={vi.fn()}
        onToast={onToast}
        _adminOnly
      />
    );

    await user.click(screen.getByRole("button", { name: /Operations/i }));
    await user.click(screen.getAllByRole("button", { name: /Restore Database/i })[0]);

    expect(await screen.findByLabelText(/Server Archive/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Backup File \(\.zip\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Portfolio recovery/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Restore Selected Archive/i }));
    expect(await screen.findByText(/database and managed documents/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Restore Archive$/i }));

    await waitFor(() => {
      expect(settingsApi.restoreServerBackup).toHaveBeenCalledWith(
        "license_lifecycle_pre_portfolio_reset_20260724.zip",
      );
    });
    expect(onToast).toHaveBeenCalledWith(
      "Database and document restore initiated - the server is restarting and may be unavailable for about 10 seconds.",
      "info",
    );
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
    await user.type(screen.getByLabelText(/^Username$/i), "newuser");
    await user.type(screen.getByLabelText(/^Email$/i), "new@example.com");
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

  test("keeps the contract delete control isolated from tile activation", async () => {
    const user = userEvent.setup();
    contractsApi.getContracts.mockResolvedValue({
      data: [{
        id: 4,
        publisherName: "Acme",
        contractNumber: "CN-4",
        licenseCount: 1,
        documentCount: 0,
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });
    wrapWithQueryClient(
      <ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />
    );

    const deleteButton = await screen.findByRole("button", { name: /Delete contract CN-4/i });
    deleteButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: /Delete Contract/i })).toBeInTheDocument();
    expect(screen.queryByText("Contract 4 opened")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    const tile = screen.getByRole("button", { name: /Open contract CN-4/i });
    tile.focus();
    await user.keyboard(" ");
    expect(screen.getByText("Contract 4 opened")).toBeInTheDocument();
  });

  test("refreshes the contracts query after a modal mutation", async () => {
    const user = userEvent.setup();
    contractsApi.getContracts
      .mockResolvedValueOnce({
        data: [{ id: 4, publisherName: "Acme", contractNumber: "CN-4", licenseCount: 1, documentCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: 4, publisherName: "Acme", contractNumber: "CN-4", licenseCount: 1, documentCount: 2, createdAt: "2026-01-01T00:00:00Z" }],
        error: null,
      });
    wrapWithQueryClient(
      <ContractsPage user={admin} userSettings={userSettings} showError={vi.fn()} />
    );

    await user.click(await screen.findByRole("button", { name: /Open contract CN-4/i }));
    await user.click(screen.getByRole("button", { name: /Simulate contract change/i }));

    await waitFor(() => {
      expect(contractsApi.getContracts).toHaveBeenCalledTimes(2);
      expect(screen.getByText("2 documents")).toBeInTheDocument();
    });
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
        { id: 11, publisherName: "Acme", softwareDescription: "Acme Suite", quantity: "2", currency: "EUR", isRenewal: true, renewalForLicenseId: 101 },
        { id: 12, publisherName: "Acme", softwareDescription: "Acme Suite", quantity: "3", currency: "EUR", isRenewal: true, renewalForLicenseId: 102 },
      ],
    },
  ];
  const mergeLicenses = [
    license({ id: 101, publisherName: "Acme", softwareDescription: "Acme Suite", endDate: "2026-12-31", skuCode: "ACME-SUITE" }),
    license({ id: 102, publisherName: "Acme", softwareDescription: "Acme Suite", endDate: "2026-12-31", skuCode: "" }),
  ];
  const fractionalMergeItems = [{
    ...mergeItems[0],
    items: [
      { ...mergeItems[0].items[0], quantity: "1.25" },
      { ...mergeItems[0].items[1], quantity: "2.5" },
    ],
  }];

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
    expect(screen.getByText("Acme Trial")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search sourcing requests/i), "nothing");
    expect(screen.getByText(/No requests match your search\./i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Search sourcing requests/i));
    await user.click(screen.getByRole("button", { name: /Add Request/i }));
    await user.click(screen.getByRole("button", { name: /Save sourcing item/i }));
    expect(await screen.findByText("Created Sourcing App")).toBeInTheDocument();
  });

  test("keeps active sourcing requests open by default and collapses them independently", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [
        {
          id: 101,
          supplier: "Shared Supplier",
          contactEmail: null,
          status: "sourcing",
          createdAt: "2026-02-01T00:00:00Z",
          quoteDocuments: [],
          items: [{
            id: 1010,
            publisherName: "Publisher One",
            softwareDescription: "First Suite",
            quantity: "1",
            currency: "EUR",
            status: "sourcing",
            isRenewal: false,
          }],
        },
        {
          id: 102,
          supplier: "Shared Supplier",
          contactEmail: null,
          status: "sourcing",
          createdAt: "2026-02-02T00:00:00Z",
          quoteDocuments: [],
          items: [{
            id: 1020,
            publisherName: "Publisher Two",
            softwareDescription: "Second Suite",
            quantity: "1",
            currency: "EUR",
            status: "sourcing",
            isRenewal: false,
          }],
        },
      ],
      error: null,
    });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("First Suite")).toBeInTheDocument();
    expect(screen.getByText("Second Suite")).toBeInTheDocument();

    const firstRequestRow = document.querySelector('[data-sourcing-request-row="101"]');
    await user.click(firstRequestRow);
    expect(screen.queryByText("First Suite")).not.toBeInTheDocument();
    expect(screen.getByText("Second Suite")).toBeInTheDocument();

    await user.click(firstRequestRow);
    expect(screen.getByText("First Suite")).toBeInTheDocument();
  });

  test("renders renewal sourcing rows when the shared licenses cache is already populated", async () => {
    const queryClient = createTestQueryClient();
    const cachedLicense = license({
      id: 42,
      publisherName: "Cache Publisher",
      softwareDescription: "Cache Suite",
    });
    queryClient.setQueryData(queryKeys.licenses, {
      licenses: [cachedLicense],
      customFieldValuesMap: new Map(),
    });
    licensesApi.getLicenses.mockResolvedValueOnce({ data: [cachedLicense], error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{
        id: 3,
        supplier: "Renewal Supplier",
        contactEmail: null,
        createdAt: "2026-01-03T00:00:00Z",
        quoteDocuments: [],
        items: [{
          id: 30,
          publisherName: "Renewal Publisher",
          softwareDescription: "Renewal App",
          quantity: "1",
          currency: "EUR",
          isRenewal: true,
          renewalForLicenseId: 42,
        }],
      }],
      error: null,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SourcingPage user={admin} userSettings={userSettings} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Renewal Supplier")).toBeInTheDocument();
    expect(await screen.findByText("Renewing: Cache Publisher")).toBeInTheDocument();
  });

  test("reloads request-level supplier after a line edit and uses it for search", async () => {
    const user = userEvent.setup();
    const unassigned = {
      id: 7,
      supplier: null,
      contactEmail: null,
      status: "sourcing",
      createdAt: "2026-01-07T00:00:00Z",
      quoteDocuments: [],
      items: [{
        id: 70,
        publisherName: "Adobe",
        softwareDescription: "Creative Cloud",
        quantity: "1",
        currency: "EUR",
        supplier: null,
        contactEmail: null,
        status: "sourcing",
        isRenewal: false,
      }],
    };
    const assigned = {
      ...unassigned,
      supplier: "Adobe Direct",
      items: unassigned.items.map((item) => ({ ...item, supplier: "Adobe Direct" })),
    };
    sourcingApi.getSourcingRequests
      .mockResolvedValueOnce({ data: [unassigned], error: null })
      .mockResolvedValue({ data: [assigned], error: null });
    sourcingApi.updateSourcingItem.mockResolvedValueOnce({
      data: assigned.items[0],
      error: null,
    });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);
    expect(await screen.findByText("Unassigned supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await user.type(screen.getByLabelText(/request supplier/i), "Adobe Direct");
    await user.click(screen.getByRole("button", { name: /save sourcing item/i }));

    expect(await screen.findByText("Adobe Direct")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/search sourcing requests/i), "Adobe Direct");
    expect(screen.getByText("Adobe Direct")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned supplier")).not.toBeInTheDocument();
  });

  test("adds a linked support line when adding to an existing sourcing request", async () => {
    const user = userEvent.setup();
    const request = {
      id: 8,
      supplier: "Primary Supplier",
      contactEmail: null,
      status: "sourcing",
      createdAt: "2026-01-08T00:00:00Z",
      quoteDocuments: [],
      items: [{
        id: 80,
        publisherName: "Existing Publisher",
        softwareDescription: "Existing App",
        quantity: "1",
        currency: "EUR",
        supplier: "Primary Supplier",
        status: "sourcing",
        isRenewal: false,
      }],
    };
    const createdPrimary = {
      id: 81,
      publisherName: "Created Publisher",
      softwareDescription: "Created Sourcing App",
      quantity: "3",
      currency: "EUR",
      supplier: "Primary Supplier",
      status: "sourcing",
      isRenewal: false,
    };
    sourcingApi.getSourcingRequests.mockResolvedValue({ data: [request], error: null });
    sourcingApi.addSourcingRequestItem
      .mockResolvedValueOnce({ data: { ...request, items: [...request.items, createdPrimary] }, error: null })
      .mockResolvedValueOnce({ data: { ...request, items: [...request.items, createdPrimary] }, error: null });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Primary Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add license line/i }));
    await user.click(screen.getByLabelText(/add maintenance companion/i));
    await user.click(screen.getByRole("button", { name: /save sourcing item/i }));

    await waitFor(() => {
      expect(sourcingApi.addSourcingRequestItem).toHaveBeenCalledTimes(2);
      expect(sourcingApi.addSourcingRequestItem).toHaveBeenNthCalledWith(
        1,
        8,
        expect.objectContaining({
          publisherName: "Created Publisher",
          softwareDescription: "Created Sourcing App",
          supplier: "Primary Supplier",
        }),
      );
      expect(sourcingApi.addSourcingRequestItem).toHaveBeenNthCalledWith(
        2,
        8,
        expect.objectContaining({
          licenseType: "maintenance",
          parentSourcingItemId: 81,
          supplier: "Primary Supplier",
        }),
      );
    });
  });

  test("converts an all-freeware request directly to the Registry", async () => {
    const user = userEvent.setup();
    const onNavigateToLicense = vi.fn();
    const freewareRequest = {
      id: 4,
      supplier: "Direct",
      contactEmail: null,
      status: "sourcing",
      createdAt: "2026-07-23T00:00:00Z",
      quoteDocuments: [],
      items: [{
        id: 40,
        publisherName: "The Document Foundation",
        softwareDescription: "LibreOffice Calc",
        licenseType: "freeware",
        quantity: "1",
        currency: "EUR",
        status: "sourcing",
        isRenewal: false,
      }],
    };
    sourcingApi.getSourcingRequests
      .mockResolvedValueOnce({ data: [freewareRequest], error: null })
      .mockResolvedValue({ data: [], error: null });
    sourcingApi.convertFreewareSourcingRequest.mockResolvedValueOnce({
      data: [{ id: 501, licenseRef: "LT-2026-00501", licenseType: "freeware" }],
      error: null,
    });

    wrapWithQueryClient(
      <SourcingPage
        user={admin}
        userSettings={userSettings}
        onNavigateToLicense={onNavigateToLicense}
      />
    );

    expect(await screen.findByText("Direct")).toBeInTheDocument();
    const requestRow = document.querySelector('[data-sourcing-request-row="4"]');
    await user.click(within(requestRow).getByRole("button", { name: /convert to registry/i }));
    const dialog = screen.getByRole("dialog", { name: /convert to license registry/i });
    expect(within(dialog).getByText("Create active Freeware / Open Source licenses for all 1 open line?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /convert to registry/i }));

    await waitFor(() => {
      expect(sourcingApi.convertFreewareSourcingRequest).toHaveBeenCalledWith(4);
      expect(screen.getByText(/1 Freeware \/ Open Source license added to the Registry/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /view license/i }));
    expect(onNavigateToLicense).toHaveBeenCalledWith(501);
  });

  test("merge modal opens and cancel, close, and overlay dismiss it when not merging", async () => {
    const user = userEvent.setup();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Suite").length).toBeGreaterThan(0);
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
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    sourcingApi.updateSourcingItem.mockResolvedValueOnce({ data: { id: 99, quantity: "9" }, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Suite").length).toBeGreaterThan(0);
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

  test("keeps fractional quantities exact across the table, merge modal, API, and success text", async () => {
    const user = userEvent.setup();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: fractionalMergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockResolvedValueOnce({
      data: { id: 99, quantity: "3.75" },
      error: null,
    });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("2.5")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));

    const dialog = screen.getByRole("dialog", { name: /merge renewal sourcing items/i });
    expect(within(dialog).getByText("1.25")).toBeInTheDocument();
    expect(within(dialog).getByText("2.5")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/final quantity/i)).toHaveValue("3.75");
    expect(within(dialog).getByText("Combined quantity:")).toHaveTextContent("3.75");
    await user.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    await waitFor(() => {
      expect(sourcingApi.mergeSourcingItems).toHaveBeenCalledWith([11, 12]);
      expect(sourcingApi.updateSourcingItem).not.toHaveBeenCalled();
      expect(screen.getByText(/one renewal for 3\.75 seats/i)).toBeInTheDocument();
    });
  });

  test("canonicalizes a comma-decimal final override exactly for the update and success text", async () => {
    const user = userEvent.setup();
    const commaSettings = { ...userSettings, numberFormatLocale: "de-DE" };
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: fractionalMergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockResolvedValueOnce({
      data: { id: 99, quantity: "3.75" },
      error: null,
    });
    sourcingApi.updateSourcingItem.mockResolvedValueOnce({
      data: { id: 99, quantity: "4.125" },
      error: null,
    });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={commaSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("1,25")).toBeInTheDocument();
    expect(screen.getByText("2,5")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));

    const dialog = screen.getByRole("dialog", { name: /merge renewal sourcing items/i });
    expect(within(dialog).getByText("1,25")).toBeInTheDocument();
    expect(within(dialog).getByText("2,5")).toBeInTheDocument();
    const quantityInput = within(dialog).getByLabelText(/final quantity/i);
    expect(quantityInput).toHaveValue("3,75");
    expect(within(dialog).getByText("Combined quantity:")).toHaveTextContent("3,75");
    await user.clear(quantityInput);
    await user.type(quantityInput, "4,1250");
    await user.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    await waitFor(() => {
      expect(sourcingApi.updateSourcingItem).toHaveBeenCalledWith(99, { quantity: "4.125" });
      expect(screen.getByText(/one renewal for 4,125 seats/i)).toBeInTheDocument();
    });
  });

  test("rejects blank, invalid, zero, and negative final merge quantities", async () => {
    const user = userEvent.setup();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.disabled);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /merge selected \(2\)/i }));

    const dialog = screen.getByRole("dialog", { name: /merge renewal sourcing items/i });
    const quantityInput = within(dialog).getByLabelText(/final quantity/i);
    const mergeButton = within(dialog).getByRole("button", { name: /^merge$/i });

    for (const value of ["", "invalid", "0", "-1"]) {
      await user.clear(quantityInput);
      if (value) await user.type(quantityInput, value);
      expect(mergeButton).toBeDisabled();
      expect(quantityInput).toHaveAttribute("aria-invalid", "true");
    }
    expect(sourcingApi.mergeSourcingItems).not.toHaveBeenCalled();
  });

  test("displays a stored fractional sourcing quantity without integer rounding", async () => {
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{
        id: 8,
        supplier: "Fractional Supplier",
        contactEmail: null,
        createdAt: "2026-07-25T00:00:00Z",
        quoteDocuments: [],
        items: [{
          id: 80,
          publisherName: "Fractional Publisher",
          softwareDescription: "Fractional Product",
          quantity: "3.75",
          currency: "EUR",
          isRenewal: false,
        }],
      }],
      error: null,
    });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Fractional Supplier")).toBeInTheDocument();
    const row = document.querySelector('[data-sourcing-row="80"]');
    expect(within(row).getByText("3.75")).toBeInTheDocument();
    expect(within(row).queryByText("4")).not.toBeInTheDocument();
  });

  test("merge modal cannot close while merging", async () => {
    const user = userEvent.setup();
    const pendingMerge = deferred();
    licensesApi.getLicenses.mockResolvedValueOnce({ data: mergeLicenses, error: null });
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: mergeItems, error: null });
    sourcingApi.mergeSourcingItems.mockReturnValueOnce(pendingMerge.promise);
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Suite").length).toBeGreaterThan(0);
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

  test("cancel confirmation opens, dismisses, and confirms with the same sourcing request", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{ id: 7, supplier: "Hold Supplier", contactEmail: null, createdAt: "2026-01-01T00:00:00Z", quoteDocuments: [], items: [] }],
      error: null,
    });
    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Hold Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for sourcing request 7/i }));
    await user.click(screen.getByRole("menuitem", { name: /cancel request/i }));
    let dialog = screen.getByRole("dialog", { name: /cancel sourcing request/i });
    expect(dialog).toHaveTextContent("Move this sourcing request and its license lines to history");

    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /cancel sourcing request/i })).not.toBeInTheDocument();
    expect(sourcingApi.cancelSourcingRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /more actions for sourcing request 7/i }));
    await user.click(screen.getByRole("menuitem", { name: /cancel request/i }));
    dialog = screen.getByRole("dialog", { name: /cancel sourcing request/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel request/i }));

    await waitFor(() => {
      expect(sourcingApi.cancelSourcingRequest).toHaveBeenCalledWith(7);
      expect(screen.queryByText("Hold Supplier")).not.toBeInTheDocument();
    });
  });

  test("deletes a sourcing quote from the row action menu", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{
        id: 7,
        supplier: "Quote Supplier",
        contactEmail: null,
        createdAt: "2026-01-01T00:00:00Z",
        quoteDocuments: [{ id: 77, originalFilename: "quote.pdf" }],
        items: [],
      }],
      error: null,
    });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText("Quote Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for sourcing request 7/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete quote/i }));

    const dialog = screen.getByRole("dialog", { name: /delete quote/i });
    expect(dialog).toHaveTextContent("quote.pdf");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(sourcingApi.deleteSourcingQuoteDocument).toHaveBeenCalledWith(77);
    });
  });

  test("keeps missing sourcing quotes visible but disables download", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{
        id: 7,
        supplier: "Missing Quote Supplier",
        contactEmail: null,
        createdAt: "2026-01-01T00:00:00Z",
        quoteDocuments: [{
          id: 77,
          originalFilename: "missing-quote.pdf",
          fileAvailability: "missing",
        }],
        items: [],
      }],
      error: null,
    });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText(/1 quote · 1 unavailable/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for sourcing request 7/i }));
    const downloadItem = screen.getByRole("menuitem", { name: /file missing: missing-quote\.pdf/i });
    expect(downloadItem).toBeDisabled();
    await user.click(downloadItem);
    expect(sourcingApi.downloadSourcingQuoteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: /delete missing-quote\.pdf/i })).toBeEnabled();
  });

  test("history toggle renders a read-only searchable sourcing history table", async () => {
    const user = userEvent.setup();
    const onNavigateToPendingOrder = vi.fn();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({
      data: [{
        id: 1,
        supplier: "Active Supplier",
        contactEmail: null,
        status: "sourcing",
        createdAt: "2026-01-01T00:00:00Z",
        quoteDocuments: [],
        items: [],
      }],
      error: null,
    });
    sourcingApi.getSourcingRequestHistory.mockResolvedValueOnce({
      data: [{
        id: 8,
        supplier: "Old Budget Supplier",
        contactEmail: null,
        notes: "Budget not approved",
        status: "converted",
        createdAt: "2025-10-01T00:00:00Z",
        quoteDocuments: [],
        items: [{
          id: 80,
          pendingOrderId: 44,
          pendingOrderStatus: "pending",
          pendingOrderPoNumber: "PO-44",
          publisherName: "Microsoft",
          softwareDescription: "M365 Copilot",
          quantity: "1",
          currency: "EUR",
          status: "converted",
          isRenewal: false,
        }],
      }],
      error: null,
    });

    wrapWithQueryClient(
      <SourcingPage
        user={admin}
        userSettings={userSettings}
        onNavigateToPendingOrder={onNavigateToPendingOrder}
      />
    );

    expect(await screen.findByText("Active Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("Sourcing History")).toBeInTheDocument();
    expect(await screen.findByText("Old Budget Supplier")).toBeInTheDocument();
    expect(screen.getByText("Converted")).toBeInTheDocument();
    expect(screen.getByText(/Sourcing Request ID #8/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view po/i }));
    expect(onNavigateToPendingOrder).toHaveBeenCalledWith(44);
    expect(screen.getByText("PO-44")).toBeInTheDocument();

    await user.type(screen.getAllByLabelText(/Search sourcing requests/i)[1], "copilot");
    await user.click(screen.getByText("Old Budget Supplier"));
    expect(screen.getByText("M365 Copilot")).toBeInTheDocument();
    expect(screen.getByText("Sourcing Line ID #80")).toBeInTheDocument();
    expect(screen.getByText("New Purchase")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add License Line/i })).not.toBeInTheDocument();
  });

  test("exposes quote document actions in cancelled sourcing history", async () => {
    const user = userEvent.setup();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: [], error: null });
    sourcingApi.getSourcingRequestHistory.mockResolvedValueOnce({
      data: [{
        id: 8,
        supplier: "Cancelled Quote Supplier",
        contactEmail: null,
        notes: "Budget not approved",
        status: "cancelled",
        createdAt: "2026-01-01T00:00:00Z",
        quoteDocuments: [{ id: 81, originalFilename: "cancelled-quote.pdf" }],
        items: [],
      }],
      error: null,
    });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText(/No sourcing requests yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("Cancelled Quote Supplier")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /more document actions for sourcing request 8/i }));
    await user.click(screen.getByRole("menuitem", { name: /download cancelled-quote\.pdf/i }));
    expect(sourcingApi.downloadSourcingQuoteDocument).toHaveBeenCalledWith(81, "cancelled-quote.pdf");

    await user.click(screen.getByRole("button", { name: /more document actions for sourcing request 8/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete cancelled-quote\.pdf/i }));
    const dialog = screen.getByRole("dialog", { name: /delete quote/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(sourcingApi.deleteSourcingQuoteDocument).toHaveBeenCalledWith(81);
    });
  });

  test("history table links converted sourcing requests to converted PO history", async () => {
    const user = userEvent.setup();
    const onNavigateToPendingOrder = vi.fn();
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: [], error: null });
    sourcingApi.getSourcingRequestHistory.mockResolvedValueOnce({
      data: [{
        id: 9,
        supplier: "Fully Converted Supplier",
        contactEmail: null,
        status: "converted",
        createdAt: "2025-10-02T00:00:00Z",
        quoteDocuments: [],
        items: [{
          id: 90,
          pendingOrderId: 45,
          pendingOrderStatus: "converted",
          pendingOrderPoNumber: "PO-45",
          publisherName: "Dropbox",
          softwareDescription: "Dropbox Business Advanced",
          quantity: "31",
          currency: "EUR",
          status: "converted",
          isRenewal: true,
          renewalForLicenseId: 4,
        }],
      }],
      error: null,
    });

    wrapWithQueryClient(
      <SourcingPage
        user={admin}
        userSettings={userSettings}
        onNavigateToPendingOrder={onNavigateToPendingOrder}
      />
    );

    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("Fully Converted Supplier")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view po/i }));
    expect(onNavigateToPendingOrder).toHaveBeenCalledWith(45);
    expect(screen.getByText("PO-45")).toBeInTheDocument();
    await user.click(screen.getByText("Fully Converted Supplier"));
    const viewButtons = screen.getAllByRole("button", { name: /view po/i });
    await user.click(viewButtons[1]);
    expect(onNavigateToPendingOrder).toHaveBeenCalledTimes(2);
    expect(onNavigateToPendingOrder).toHaveBeenLastCalledWith(45);
  });

  test("paginates sourcing history", async () => {
    const user = userEvent.setup();
    const historyRows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      supplier: `History Supplier ${String(index + 1).padStart(2, "0")}`,
      contactEmail: null,
      status: "converted",
      createdAt: `2026-01-${String(21 - index).padStart(2, "0")}T00:00:00Z`,
      quoteDocuments: [],
      items: [],
    }));
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: [], error: null });
    sourcingApi.getSourcingRequestHistory.mockResolvedValueOnce({ data: historyRows, error: null });

    wrapWithQueryClient(<SourcingPage user={admin} userSettings={userSettings} />);

    expect(await screen.findByText(/No sourcing requests yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("History Supplier 01")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1-20 of 21 requests/i)).toBeInTheDocument();
    expect(screen.queryByText("History Supplier 21")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("History Supplier 21")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  test("opens a highlighted sourcing history line on its sorted page", async () => {
    const historyRows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      supplier: `Targeted Supplier ${String(index + 1).padStart(2, "0")}`,
      contactEmail: null,
      status: "converted",
      createdAt: `2026-01-${String(21 - index).padStart(2, "0")}T00:00:00Z`,
      quoteDocuments: [],
      items: [{
        id: 100 + index,
        publisherName: "Acme",
        softwareDescription: `Targeted Line ${index + 1}`,
        status: "converted",
      }],
    }));
    sourcingApi.getSourcingRequests.mockResolvedValueOnce({ data: [], error: null });
    sourcingApi.getSourcingRequestHistory.mockResolvedValueOnce({ data: historyRows, error: null });

    wrapWithQueryClient(
      <SourcingPage
        user={admin}
        userSettings={userSettings}
        highlightId={120}
        onClearHighlight={vi.fn()}
      />
    );

    expect(await screen.findByText("Targeted Supplier 21")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(await screen.findByText("Targeted Line 21")).toBeInTheDocument();
  });
});

describe("PendingOrdersPage workflows", () => {
  test("preserves start and end dates when editing a pending-order line", async () => {
    const user = userEvent.setup();
    const item = {
      id: 41,
      publisherName: "Dated Publisher",
      softwareDescription: "Dated App",
      quantity: "3",
      currency: "EUR",
      startDate: "2026-03-01",
      endDate: "2027-02-28",
      status: "converted",
      quoteDocuments: [],
    };
    const order = {
      id: 4,
      poNumber: "PO-DATED",
      supplier: "Dated Supplier",
      status: "pending",
      items: [item],
      documents: [],
      createdAt: "2026-02-01T00:00:00Z",
    };
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [order], error: null });
    pendingOrdersApi.updatePendingOrderItem.mockResolvedValueOnce({ data: order, error: null });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    await user.click(await screen.findByText("PO-DATED"));
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await user.click(screen.getByRole("button", { name: /save sourcing item/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.updatePendingOrderItem).toHaveBeenCalledWith(
        4,
        41,
        expect.objectContaining({
          startDate: "2026-03-01",
          endDate: "2027-02-28",
        }),
      );
    });
  });

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
    await user.click(screen.getByRole("button", { name: /Add Pending Order/i }));
    await user.click(screen.getByRole("button", { name: /Save pending order/i }));
    expect(await screen.findByText("PO-NEW")).toBeInTheDocument();
  });

  test("cancel confirmation opens, dismisses, and confirms with the same pending order id", async () => {
    const user = userEvent.setup();
    const onPortfolioStateChange = vi.fn();
    const onRenewalsReload = vi.fn();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{ id: 9, poNumber: "PO-DELETE", supplier: "Delete Supplier", status: "pending", items: [], createdAt: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    pendingOrdersApi.cancelPendingOrder.mockResolvedValueOnce({ error: null });
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
    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    await user.click(screen.getByRole("menuitem", { name: /cancel order/i }));
    let dialog = screen.getByRole("dialog", { name: /cancel pending order/i });
    expect(dialog).toHaveTextContent("Move this pending order and its line items to history");

    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /cancel pending order/i })).not.toBeInTheDocument();
    expect(pendingOrdersApi.cancelPendingOrder).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    await user.click(screen.getByRole("menuitem", { name: /cancel order/i }));
    dialog = screen.getByRole("dialog", { name: /cancel pending order/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel order/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.cancelPendingOrder).toHaveBeenCalledWith(9);
      expect(screen.queryByText("PO-DELETE")).not.toBeInTheDocument();
    });
    expect(onPortfolioStateChange).toHaveBeenCalled();
    expect(onRenewalsReload).toHaveBeenCalled();
  });

  test("deletes a purchase order document from the row action menu", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{
        id: 9,
        poNumber: "PO-DOC",
        supplier: "Document Supplier",
        status: "pending",
        items: [],
        documents: [{ id: 88, category: "purchase_order", originalFilename: "po.pdf" }],
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText("PO-DOC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete po/i }));

    const dialog = screen.getByRole("dialog", { name: /delete po/i });
    expect(dialog).toHaveTextContent("po.pdf");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.deletePendingOrderDocument).toHaveBeenCalledWith(88);
    });
  });

  test("keeps unavailable pending-order evidence visible but disables downloads", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{
        id: 9,
        poNumber: "PO-MISSING-DOC",
        supplier: "Document Supplier",
        status: "pending",
        items: [{
          id: 91,
          publisherName: "Acme",
          softwareDescription: "Suite",
          quantity: "1",
          currency: "EUR",
          quoteDocuments: [{
            id: 66,
            originalFilename: "unavailable-quote.pdf",
            fileAvailability: "unavailable",
          }],
        }],
        documents: [{
          id: 88,
          category: "purchase_order",
          originalFilename: "missing-po.pdf",
          fileAvailability: "missing",
        }],
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText(/1 PO · 1 unavailable/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    const poDownload = screen.getByRole("menuitem", { name: /file missing: missing-po\.pdf/i });
    const quoteDownload = screen.getByRole("menuitem", { name: /storage unavailable: unavailable-quote\.pdf/i });
    expect(poDownload).toBeDisabled();
    expect(quoteDownload).toBeDisabled();
    await user.click(poDownload);
    await user.click(quoteDownload);
    expect(pendingOrdersApi.downloadPendingOrderDocument).not.toHaveBeenCalled();
    expect(sourcingApi.downloadSourcingQuoteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: /delete missing-po\.pdf/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /delete unavailable-quote\.pdf/i })).toBeEnabled();
  });

  test("exposes sourcing quote documents in the pending order row action menu", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{
        id: 9,
        poNumber: "PO-QUOTE",
        supplier: "Quote Supplier",
        status: "pending",
        items: [{
          id: 91,
          publisherName: "Figma",
          softwareDescription: "Professional Seats",
          quantity: "10",
          estimatedTotalPrice: "1200",
          currency: "EUR",
          quoteDocuments: [{ id: 66, originalFilename: "pending-quote.pdf" }],
        }],
        documents: [],
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText("PO-QUOTE")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    await user.click(screen.getByRole("menuitem", { name: /download pending-quote\.pdf/i }));
    expect(sourcingApi.downloadSourcingQuoteDocument).toHaveBeenCalledWith(66, "pending-quote.pdf");

    await user.click(screen.getByRole("button", { name: /more actions for pending order 9/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete pending-quote\.pdf/i }));

    const dialog = screen.getByRole("dialog", { name: /delete quote/i });
    expect(dialog).toHaveTextContent("pending-quote.pdf");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(sourcingApi.deleteSourcingQuoteDocument).toHaveBeenCalledWith(66);
    });
  });

  test("last PO line delete warns that the pending order will move to history", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{
        id: 9,
        poNumber: "PO-LAST",
        supplier: "Last Supplier",
        status: "pending",
        items: [{
          id: 91,
          publisherName: "Figma",
          softwareDescription: "Professional Seats",
          quantity: "10",
          estimatedTotalPrice: "1200",
          currency: "EUR",
          status: "converted",
        }],
        documents: [],
        createdAt: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });
    pendingOrdersApi.deletePendingOrderItem.mockResolvedValueOnce({
      data: {
        id: 9,
        poNumber: "PO-LAST",
        supplier: "Last Supplier",
        status: "cancelled",
        items: [],
        documents: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText("PO-LAST")).toBeInTheDocument();
    await user.click(screen.getByText("PO-LAST"));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("dialog", { name: /delete po line item/i });
    expect(dialog).toHaveTextContent("This is the last line on PO-LAST");
    expect(dialog).toHaveTextContent("will cancel the pending order and move it to history");

    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(pendingOrdersApi.deletePendingOrderItem).toHaveBeenCalledWith(9, 91);
    });
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
    await user.click(screen.getByRole("button", { name: /more actions for pending order 12/i }));
    await user.click(screen.getByRole("menuitem", { name: /Retry Evidence/i }));

    await waitFor(() => {
      expect(pendingOrdersApi.retryPendingOrderEvidenceTransfer).toHaveBeenCalledWith(12);
      expect(showSuccess).toHaveBeenCalledWith("Evidence transfer retry started.");
    });
  });

  test("history toggle renders a read-only searchable pending order history table", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [], error: null });
    pendingOrdersApi.getPendingOrderHistory.mockResolvedValueOnce({
      data: [
        {
          id: 22,
          poNumber: "PO-HIST-22",
          supplier: "History Supplier",
          status: "converted",
          items: [{
            id: 220,
            publisherName: "Adobe",
            softwareDescription: "Creative Cloud All Apps",
            quantity: "25",
            estimatedUnitPrice: "57.78",
            estimatedTotalPrice: "1444.50",
            currency: "EUR",
            status: "converted",
            isRenewal: true,
            convertedLicenseId: 501,
            convertedLicenseRef: "LT-0501",
            convertedLicenseIds: [501],
            quoteDocuments: [],
          }],
          convertedLicenseId: 501,
          convertedLicenseRef: "LT-0501",
          convertedLicenseIds: [501],
          documents: [{ id: 5, category: "purchase_order", originalFilename: "po-hist.pdf" }],
          createdAt: "2026-01-02T00:00:00Z",
        },
        {
          id: 23,
          poNumber: "PO-CANCELLED",
          supplier: "Cancelled Supplier",
          status: "cancelled",
          items: [],
          documents: [],
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    const onNavigateToLicense = vi.fn();

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
        onNavigateToLicense={onNavigateToLicense}
      />
    );

    expect(await screen.findByText(/No pending orders yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("Pending Order History")).toBeInTheDocument();
    expect(await screen.findByText("PO-HIST-22")).toBeInTheDocument();
    expect(screen.getByText("Pending Order #22")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view license/i })).toBeInTheDocument();
    expect(screen.getByText("LT-0501")).toBeInTheDocument();
    expect(screen.getByText("Reference only")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Search pending order history/i), "creative");
    expect(screen.getByText("PO-HIST-22")).toBeInTheDocument();
    expect(screen.queryByText("PO-CANCELLED")).not.toBeInTheDocument();

    await user.click(screen.getByText("PO-HIST-22"));
    expect(screen.getByText("Creative Cloud All Apps")).toBeInTheDocument();
    expect(screen.getByText("Pending Order Line ID #220")).toBeInTheDocument();
    expect(screen.getAllByText("Renewal")).not.toHaveLength(0);
    await user.click(screen.getAllByRole("button", { name: /view license/i }).at(-1));
    expect(onNavigateToLicense).toHaveBeenCalledWith(501);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^convert$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add license line/i })).not.toBeInTheDocument();
  });

  test("exposes PO and quote document actions in pending order history", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [], error: null });
    pendingOrdersApi.getPendingOrderHistory.mockResolvedValueOnce({
      data: [{
        id: 22,
        poNumber: "PO-HIST-DOC",
        supplier: "History Document Supplier",
        status: "cancelled",
        items: [{
          id: 221,
          publisherName: "Adobe",
          softwareDescription: "Creative Cloud",
          quantity: "1",
          currency: "EUR",
          quoteDocuments: [{ id: 67, originalFilename: "history-quote.pdf" }],
        }],
        documents: [{ id: 89, category: "purchase_order", originalFilename: "history-po.pdf" }],
        createdAt: "2026-01-02T00:00:00Z",
      }],
      error: null,
    });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText(/No pending orders yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("PO-HIST-DOC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /more document actions for pending order 22/i }));
    await user.click(screen.getByRole("menuitem", { name: /download history-po\.pdf/i }));
    expect(pendingOrdersApi.downloadPendingOrderDocument).toHaveBeenCalledWith(89, "history-po.pdf");

    await user.click(screen.getByRole("button", { name: /more document actions for pending order 22/i }));
    await user.click(screen.getByRole("menuitem", { name: /delete history-quote\.pdf/i }));
    const dialog = screen.getByRole("dialog", { name: /delete quote/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(sourcingApi.deleteSourcingQuoteDocument).toHaveBeenCalledWith(67);
    });
  });

  test("paginates pending order history", async () => {
    const user = userEvent.setup();
    const historyRows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      poNumber: `PO-HISTORY-${String(index + 1).padStart(2, "0")}`,
      supplier: `History Supplier ${String(index + 1).padStart(2, "0")}`,
      status: "converted",
      items: [],
      documents: [],
      createdAt: `2026-01-${String(21 - index).padStart(2, "0")}T00:00:00Z`,
    }));
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [], error: null });
    pendingOrdersApi.getPendingOrderHistory.mockResolvedValueOnce({ data: historyRows, error: null });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
      />
    );

    expect(await screen.findByText(/No pending orders yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByText("PO-HISTORY-01")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1-20 of 21 orders/i)).toBeInTheDocument();
    expect(screen.queryByText("PO-HISTORY-21")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("PO-HISTORY-21")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  test("opens a highlighted pending order on its sorted history page", async () => {
    const historyRows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      poNumber: `PO-TARGET-${String(index + 1).padStart(2, "0")}`,
      supplier: `Targeted Supplier ${String(index + 1).padStart(2, "0")}`,
      status: "converted",
      items: [{
        id: 200 + index,
        publisherName: "Acme",
        softwareDescription: `Targeted PO Line ${index + 1}`,
        status: "converted",
      }],
      documents: [],
      createdAt: `2026-01-${String(21 - index).padStart(2, "0")}T00:00:00Z`,
    }));
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({ data: [], error: null });
    pendingOrdersApi.getPendingOrderHistory.mockResolvedValueOnce({ data: historyRows, error: null });

    wrapWithQueryClient(
      <PendingOrdersPage
        user={admin}
        userSettings={userSettings}
        showError={vi.fn()}
        showSuccess={vi.fn()}
        highlightId={21}
        onClearHighlight={vi.fn()}
      />
    );

    expect(await screen.findByText("PO-TARGET-21")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(await screen.findByText("Targeted PO Line 21")).toBeInTheDocument();
  });
});

describe("ReportsPage workflows", () => {
  test("renders empty reports, happy-path report data, and export errors", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    wrapWithQueryClient(<ReportsPage userSettings={userSettings} onError={onError} />);
    await user.click(await screen.findByRole("button", { name: /Cost Overview & Forecast/ }));
    expect(await screen.findAllByText(/No data available for the current filters/i)).not.toHaveLength(0);
    cleanup();
    window.sessionStorage.clear();

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
    await screen.findByRole("button", { name: /Cost Overview & Forecast/ });
    await user.click(screen.getByRole("button", { name: /Cost Overview & Forecast/ }));
    await user.click(screen.getByRole("button", { name: /Publisher & Vendor Overview/ }));
    expect(await screen.findAllByText("Report Publisher")).not.toHaveLength(0);
    expect(screen.getByText(/Showing 3 licenses/i)).toBeInTheDocument();
    expect(screen.getByText("Cost Overview & Forecast")).toBeInTheDocument();
    expect(screen.getByText(/2 active recurring records/i)).toBeInTheDocument();
    expect(screen.getByText("maintenance@example.com")).toBeInTheDocument();

    pdfExport.exportFullReportPdf.mockRejectedValueOnce(new Error("PDF failed"));
    await user.click(screen.getAllByRole("button", { name: /Export filtered report/i }).at(-1));
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

    render(
      <NotificationsPage
        notifications={[{
          license_id: 7,
          publisher: "Acme",
          software_name: "Renewal Suite",
          type: "expiring",
          detail: "Expires in 5 days",
          budget_owner_email: "owner@example.com",
        }]}
        globalSettings={globalSettings}
        setSelectedId={setSelectedId}
        setPage={setPage}
      />
    );
    const row = await screen.findByRole("button", { name: /View license/i });
    expect(row).toHaveTextContent("Renewal Suite");
    expect(row).toHaveTextContent("owner@example.com");
    await userEvent.click(row);
    expect(setSelectedId).toHaveBeenCalledWith(7);
    expect(setPage).toHaveBeenCalledWith("licenses");
  });

  test("does not show all clear when the notification request fails", async () => {
    const retry = vi.fn();
    render(
      <NotificationsPage
        notifications={[]}
        notificationData={null}
        notificationsLoading={false}
        notificationsError="Service unavailable"
        notificationsFetching={false}
        onRetryNotifications={retry}
        globalSettings={globalSettings}
        setSelectedId={vi.fn()}
        setPage={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable");
    expect(screen.queryByText(/All clear/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("keeps the last valid notifications visible after a refresh failure", () => {
    render(
      <NotificationsPage
        notifications={[]}
        notificationData={[{
          license_id: 8,
          publisher: "Acme",
          software_name: "Stale Renewal",
          type: "expired",
          detail: "Expired yesterday",
          relevant_date: "2026-08-25",
        }]}
        notificationsLoading={false}
        notificationsError="Refresh failed"
        notificationsFetching={false}
        onRetryNotifications={vi.fn()}
        globalSettings={globalSettings}
        setSelectedId={vi.fn()}
        setPage={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Stale Renewal/ })).toBeInTheDocument();
    expect(screen.getByText(/Showing the last valid notification result/i)).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).not.toBeInTheDocument();
  });
});

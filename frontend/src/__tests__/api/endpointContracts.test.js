import { afterEach, describe, expect, test, vi } from "vitest";

import * as client from "../../api/client.js";
import * as licensesApi from "../../api/licenses.js";
import * as settingsApi from "../../api/settings.js";
import * as usersApi from "../../api/users.js";
import * as documentsApi from "../../api/documents.js";
import * as pluginActionsApi from "../../api/pluginActions.js";
import * as pluginSuggestionsApi from "../../api/pluginSuggestions.js";
import * as pendingOrdersApi from "../../api/pendingOrders.js";
import * as sourcingApi from "../../api/sourcing.js";
import * as csvImportApi from "../../api/csvImport.js";
import { getPortfolioStats } from "../../api/reports.js";

vi.mock("../../api/client.js", () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  request: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: {}, error: null });
  client.post.mockResolvedValue({ data: {}, error: null });
  client.put.mockResolvedValue({ data: {}, error: null });
  client.patch.mockResolvedValue({ data: {}, error: null });
  client.del.mockResolvedValue({ data: null, error: null });
  client.request.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("frontend API endpoint contracts", () => {
  test("license API maps high-risk calls to the expected paths and payloads", async () => {
    await licensesApi.getLicenses();
    expect(client.get).toHaveBeenLastCalledWith("/api/licenses");

    await licensesApi.getLicenses({ includeRetired: true });
    expect(client.get).toHaveBeenLastCalledWith("/api/licenses?include_retired=true");

    await licensesApi.getLicenseProcurementTrail(7);
    expect(client.get).toHaveBeenLastCalledWith("/api/licenses/7/procurement-trail");

    const batch = [{ license: { publisherName: "Acme" } }];
    await licensesApi.createLicenseBatch(batch);
    expect(client.post).toHaveBeenLastCalledWith("/api/licenses/batch", { items: batch });

    await licensesApi.initiateRenewalBundle([7, 8]);
    expect(client.post).toHaveBeenLastCalledWith("/api/licenses/renewal-bundle/initiate", { licenseIds: [7, 8] });

    await licensesApi.linkExistingSuccessor(7, 8);
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/licenses/7/link-existing-successor",
      { successorLicenseId: 8 },
    );

    await licensesApi.unlinkExistingSuccessor(7);
    expect(client.post).toHaveBeenLastCalledWith("/api/licenses/7/unlink-existing-successor", {});

    await licensesApi.bulkDeleteLicenses([1, 2]);
    expect(client.request).toHaveBeenLastCalledWith("/api/licenses/bulk", {
      method: "DELETE",
      body: JSON.stringify({ ids: [1, 2] }),
    });

    await licensesApi.patchLicenseField(7, "publisherName", "Acme");
    expect(client.patch).toHaveBeenLastCalledWith(
      "/api/licenses/7/field",
      { field: "publisherName", value: "Acme" },
    );

    await licensesApi.clearPoTotalOverride(7);
    expect(client.del).toHaveBeenLastCalledWith("/api/licenses/7/po-total-override");

    await licensesApi.markLicenseNoticeHandled(7);
    expect(client.post).toHaveBeenLastCalledWith("/api/licenses/7/notice/handled", {});
  });

  test("settings and user APIs preserve backend route and payload shape", async () => {
    await settingsApi.updateGlobalSettings({ notification_days: 45 });
    expect(client.put).toHaveBeenLastCalledWith("/api/settings/global", { notification_days: 45 });

    await settingsApi.restoreBackup(new File(["zip"], "backup.zip", { type: "application/zip" }));
    expect(client.post.mock.calls.at(-1)[0]).toBe("/api/backup/restore");
    expect(client.post.mock.calls.at(-1)[1]).toBeInstanceOf(FormData);

    await settingsApi.restoreServerBackup("license_lifecycle_backup_20260724.zip");
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/backup/restore-server",
      { filename: "license_lifecycle_backup_20260724.zip" },
    );

    await settingsApi.previewPortfolioReset();
    expect(client.get).toHaveBeenLastCalledWith("/api/operations/portfolio-reset/preview");

    await settingsApi.resetPortfolio("RESET PORTFOLIO");
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/operations/portfolio-reset",
      { confirmation: "RESET PORTFOLIO" },
    );

    await settingsApi.createApiToken({ name: "CMDB", scopes: ["licenses:read"] });
    expect(client.post).toHaveBeenLastCalledWith("/api/api-tokens", { name: "CMDB", scopes: ["licenses:read"] });

    await settingsApi.revokeApiToken(8);
    expect(client.del).toHaveBeenLastCalledWith("/api/api-tokens/8");

    await settingsApi.createWebhook({ name: "CMDB", url: "https://example.com/hook", events: ["license.created"] });
    expect(client.post).toHaveBeenLastCalledWith("/api/webhooks", { name: "CMDB", url: "https://example.com/hook", events: ["license.created"] });

    await settingsApi.listWebhookDeliveries(4);
    expect(client.get).toHaveBeenLastCalledWith("/api/webhooks/4/deliveries");

    await settingsApi.testWebhook(4);
    expect(client.post).toHaveBeenLastCalledWith("/api/webhooks/4/test");

    await settingsApi.listExtensionCapabilities();
    expect(client.get).toHaveBeenLastCalledWith("/api/extensions/capabilities");

    await settingsApi.deleteExtensionCapability("licensetrack-ai");
    expect(client.del).toHaveBeenLastCalledWith("/api/extensions/capabilities/licensetrack-ai");

    await usersApi.updateUserDepartments(3, ["Finance", "IT"]);
    expect(client.put).toHaveBeenLastCalledWith("/api/users/3/departments", { departments: ["Finance", "IT"] });
  });

  test("import mapping updates preserve the complete mapping payload", async () => {
    const mapping = [{ rawHeader: "Publisher", target: "publisher_name" }];

    await csvImportApi.putImportMapping(7, "Renamed Mapping", mapping);

    expect(client.put).toHaveBeenLastCalledWith("/api/import/mappings/7", {
      name: "Renamed Mapping",
      mapping,
    });
  });

  test("document, pending-order, and sourcing APIs use multipart bodies for uploads and conversion attachments", async () => {
    const file = new File(["hello"], "invoice.pdf", { type: "application/pdf" });

    await documentsApi.uploadDocument(9, file, "invoice");
    expect(client.post.mock.calls.at(-1)[0]).toBe("/api/licenses/9/documents");
    expect(client.post.mock.calls.at(-1)[1]).toBeInstanceOf(FormData);

    await documentsApi.listDocumentActions();
    expect(client.get).toHaveBeenLastCalledWith("/api/document-actions");

    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    client.get.mockResolvedValueOnce({
      data: { blob: vi.fn().mockResolvedValue(new Blob(["document"])) },
      error: null,
    });
    await documentsApi.downloadDocument(3, "license.pdf");
    expect(client.get).toHaveBeenLastCalledWith("/api/documents/3/download");
    client.get.mockResolvedValueOnce({
      data: { blob: vi.fn().mockResolvedValue(new Blob(["procurement"])) },
      error: null,
    });
    await documentsApi.downloadProcurementDocument(4, "po.pdf");
    expect(client.get).toHaveBeenLastCalledWith("/api/procurement-documents/4/download");

    client.get.mockResolvedValueOnce({
      data: { blob: vi.fn().mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" })) },
      error: null,
    });
    await documentsApi.previewDocument(3);
    expect(client.get).toHaveBeenLastCalledWith("/api/documents/3/download");
    client.get.mockResolvedValueOnce({
      data: { blob: vi.fn().mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" })) },
      error: null,
    });
    await documentsApi.previewProcurementDocument(4);
    expect(client.get).toHaveBeenLastCalledWith("/api/procurement-documents/4/download");

    await documentsApi.invokeDocumentAction("request_processing", { documentType: "license_document", documentId: 3 });
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/document-actions/request_processing/invoke",
      { documentType: "license_document", documentId: 3 }
    );

    await pluginActionsApi.listPluginActions({
      slot: "document.row.actions",
      targetType: "license_document",
      targetId: 3,
    });
    expect(client.get).toHaveBeenLastCalledWith(
      "/api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId=3"
    );

    await pluginActionsApi.invokePluginAction("plugin-ai", "parseDocument", {
      targetType: "license_document",
      targetId: "3",
      context: { documentId: 3 },
    });
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/plugin-actions/plugin-ai/parseDocument/invoke",
      { targetType: "license_document", targetId: "3", context: { documentId: 3 } }
    );

    await documentsApi.listDocumentProcessingResults({ licenseId: 9, status: "pending" });
    expect(client.get).toHaveBeenLastCalledWith("/api/document-processing-results?license_id=9&status=pending");

    await documentsApi.acceptDocumentProcessingResult(12);
    expect(client.post).toHaveBeenLastCalledWith("/api/document-processing-results/12/accept");

    await documentsApi.acceptDocumentProcessingResult(12, [0, 2]);
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/document-processing-results/12/accept",
      { suggestedFieldIndexes: [0, 2] }
    );

    await documentsApi.rejectDocumentProcessingResult(12);
    expect(client.post).toHaveBeenLastCalledWith("/api/document-processing-results/12/reject");

    await pluginSuggestionsApi.listPluginSuggestions({ licenseId: 9, status: "pending" });
    expect(client.get).toHaveBeenLastCalledWith("/api/plugin-suggestions?licenseId=9&status=pending");

    await pluginSuggestionsApi.acceptPluginSuggestion(12);
    expect(client.post).toHaveBeenLastCalledWith("/api/plugin-suggestions/12/accept");

    await pluginSuggestionsApi.acceptPluginSuggestion(12, [0, 2]);
    expect(client.post).toHaveBeenLastCalledWith(
      "/api/plugin-suggestions/12/accept",
      { suggestedFieldIndexes: [0, 2] }
    );

    await pluginSuggestionsApi.rejectPluginSuggestion(12);
    expect(client.post).toHaveBeenLastCalledWith("/api/plugin-suggestions/12/reject");

    await pendingOrdersApi.convertPendingOrder(4, { publisherName: "Acme" }, file);
    expect(client.post.mock.calls.at(-1)[0]).toBe("/api/pending-orders/4/convert");
    expect(client.post.mock.calls.at(-1)[1]).toBeInstanceOf(FormData);

    await pendingOrdersApi.batchConvertPendingOrder(4, [{ sourcingItemId: 9 }], file);
    expect(client.post.mock.calls.at(-1)[0]).toBe("/api/pending-orders/4/convert-all");
    expect(client.post.mock.calls.at(-1)[1]).toBeInstanceOf(FormData);

    await pendingOrdersApi.getPendingOrders({ includeEvidenceIssues: true });
    expect(client.get).toHaveBeenLastCalledWith("/api/pending-orders?include_evidence_issues=true");

    await pendingOrdersApi.getPendingOrderHistory();
    expect(client.get).toHaveBeenLastCalledWith("/api/pending-orders/history");

    await pendingOrdersApi.cancelPendingOrder(4);
    expect(client.post).toHaveBeenLastCalledWith("/api/pending-orders/4/cancel");

    await pendingOrdersApi.retryPendingOrderEvidenceTransfer(4);
    expect(client.post).toHaveBeenLastCalledWith("/api/pending-orders/4/retry-evidence-transfer");

    await sourcingApi.uploadSourcingQuoteDocument(5, file);
    expect(client.post.mock.calls.at(-1)[0]).toBe("/api/sourcing/requests/5/quote-documents");
    expect(client.post.mock.calls.at(-1)[1]).toBeInstanceOf(FormData);

    await sourcingApi.getSourcingRequestHistory();
    expect(client.get).toHaveBeenLastCalledWith("/api/sourcing/requests/history");

    await sourcingApi.cancelSourcingRequest(5);
    expect(client.post).toHaveBeenLastCalledWith("/api/sourcing/requests/5/cancel");
  });

  test("reports API throws query errors so React Query can surface failure state", async () => {
    client.get.mockResolvedValueOnce({ data: null, error: "Report stats failed" });

    await expect(getPortfolioStats()).rejects.toThrow("Report stats failed");
  });
});

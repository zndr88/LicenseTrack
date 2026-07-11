import { beforeEach, describe, expect, it } from "vitest";
import { demoRequest } from "../router.js";
import { resetStore } from "../store.js";

describe("demo router", () => {
  beforeEach(() => resetStore());

  it("logs in with any non-empty credentials and seeds the store", async () => {
    const { data, error } = await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });
    expect(error).toBeNull();
    expect(data.access_token).toBeTruthy();
    expect(data.user.username).toBe("demo");
    const licenses = await demoRequest("/api/licenses", { method: "GET" });
    expect(licenses.data.length).toBeGreaterThanOrEqual(12);
  });

  it("rejects empty credentials", async () => {
    const { error } = await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "", password: "" }),
    });
    expect(error).toBeTruthy();
  });

  it("logout resets the store", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });
    await demoRequest("/api/auth/logout", { method: "POST" });
    const { data } = await demoRequest("/api/licenses", { method: "GET" });
    expect(data).toEqual([]);
  });

  it("saves user settings in the in-memory demo session", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const save = await demoRequest("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: "gray", number_format_locale: "de-DE" }),
    });
    expect(save.error).toBeNull();
    expect(save.data.theme).toBe("gray");
    expect(save.data.number_format_locale).toBe("de-DE");

    const loaded = await demoRequest("/api/settings", { method: "GET" });
    expect(loaded.data.theme).toBe("gray");
    expect(loaded.data.number_format_locale).toBe("de-DE");
  });

  it("returns computed renewal workbench rows", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const { data, error } = await demoRequest("/api/renewals/workbench", { method: "GET" });
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
    expect(data.find((row) => row.licenseId === 1)).toMatchObject({
      publisherName: "Atlassian",
      renewalStatus: "due_soon",
      daysUntilExpiry: 20,
    });
    expect(data.find((row) => row.licenseId === 14)).toMatchObject({
      renewalStatus: "in_sourcing",
      sourcingItemId: 101,
    });
  });

  it("filters renewal workbench views", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const overdue = await demoRequest("/api/renewals/workbench?view=overdue", { method: "GET" });
    expect(overdue.error).toBeNull();
    expect(overdue.data.map((row) => row.licenseId)).toEqual([10]);

    const inProgress = await demoRequest("/api/renewals/workbench?view=in_progress", { method: "GET" });
    expect(inProgress.error).toBeNull();
    expect(inProgress.data.map((row) => row.licenseId)).toContain(14);
  });

  it("seeds separately tracked maintenance as a linked child record", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const parent = await demoRequest("/api/licenses/11", { method: "GET" });
    expect(parent.error).toBeNull();
    expect(parent.data).toMatchObject({
      licenseType: "perpetual",
      maintenanceCoverage: "separately_tracked",
      hasMaintenance: true,
      activeMaintenanceId: 15,
    });

    const children = await demoRequest("/api/licenses?parent_license_id=11&include_retired=true", { method: "GET" });
    expect(children.error).toBeNull();
    expect(children.data).toHaveLength(1);
    expect(children.data[0]).toMatchObject({
      id: 15,
      licenseType: "maintenance",
      parentLicenseId: 11,
      startDate: parent.data.maintenanceStartDate,
      endDate: parent.data.maintenanceEndDate,
      totalPoPrice: parent.data.maintenanceCost,
    });
  });

  it("seeds demo financial data in EUR only", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const licenses = await demoRequest("/api/licenses?include_retired=true", { method: "GET" });
    expect(licenses.error).toBeNull();
    expect(new Set(licenses.data.map((license) => license.currency))).toEqual(new Set(["EUR"]));

    const sourcing = await demoRequest("/api/sourcing", { method: "GET" });
    expect(sourcing.error).toBeNull();
    expect(new Set(sourcing.data.map((item) => item.currency))).toEqual(new Set(["EUR"]));

    const pendingOrders = await demoRequest("/api/pending-orders", { method: "GET" });
    expect(pendingOrders.error).toBeNull();
    const poCurrencies = new Set(pendingOrders.data.flatMap((order) => order.items.map((item) => item.currency)));
    expect(poCurrencies).toEqual(new Set(["EUR"]));

    const stats = await demoRequest("/api/licenses/stats", { method: "GET" });
    expect(stats.error).toBeNull();
    expect(Object.keys(stats.data.annual_cost_by_currency)).toEqual(["EUR"]);
  });

  it("serves quiet read endpoints for top-level pages and admin tabs", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const notifications = await demoRequest("/api/notifications", { method: "GET" });
    expect(notifications.error).toBeNull();
    expect(notifications.data.some((item) => item.license_id === 1 && item.type === "expiring")).toBe(true);
    expect(notifications.data.some((item) => item.license_id === 10 && item.type === "expired")).toBe(true);
    expect(notifications.data.some((item) => item.type === "incomplete")).toBe(false);

    const reportStats = await demoRequest("/api/reports/portfolio-stats", { method: "GET" });
    expect(reportStats.error).toBeNull();
    expect(reportStats.data.by_license_type.subscription).toBeGreaterThan(0);
    expect(reportStats.data.annual_cost_by_currency).toHaveProperty("EUR");

    await expect(demoRequest("/api/extensions/capabilities", { method: "GET" }))
      .resolves.toMatchObject({ data: [], error: null });
    await expect(demoRequest("/api/custom-fields/", { method: "GET" }))
      .resolves.toMatchObject({ data: [], error: null });
    await expect(demoRequest("/api/api-tokens", { method: "GET" }))
      .resolves.toMatchObject({ data: [], error: null });
    await expect(demoRequest("/api/webhooks", { method: "GET" }))
      .resolves.toMatchObject({ data: [], error: null });
    await expect(demoRequest("/api/backup/list", { method: "GET" }))
      .resolves.toMatchObject({ data: [], error: null });
    await expect(demoRequest("/api/audit-log", { method: "GET" }))
      .resolves.toMatchObject({ data: { results: [], total: 0 }, error: null });
  });

  it("computes demo completeness notifications from current mandatory fields", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const allOff = await demoRequest("/api/notifications", { method: "GET" });
    expect(allOff.error).toBeNull();
    expect(allOff.data.some((item) => item.type === "incomplete")).toBe(false);

    await demoRequest("/api/settings/global", {
      method: "PUT",
      body: JSON.stringify({
        mandatory_fields: {
          invoice: true,
          eula: false,
          entitlement: false,
          purchaseOrder: false,
          quote: false,
          startDate: false,
          endDate: false,
          contractNumber: false,
          poNumber: false,
          invoiceNumber: false,
          contactEmail: false,
          costCentre: false,
          budgetOwnerEmail: false,
        },
      }),
    });

    const oneRequired = await demoRequest("/api/notifications", { method: "GET" });
    expect(oneRequired.error).toBeNull();
    expect(oneRequired.data.some((item) => item.type === "incomplete")).toBe(true);

    const jetbrains = await demoRequest("/api/licenses/2", { method: "GET" });
    expect(jetbrains.error).toBeNull();
    expect(jetbrains.data.publisherName).toBe("JetBrains");
    expect(jetbrains.data.completenessPct).toBe(0);
  });

  it("serves seeded contract records with linked licenses and documents", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const contracts = await demoRequest("/api/contracts", { method: "GET" });
    expect(contracts.error).toBeNull();
    expect(contracts.data.length).toBeGreaterThanOrEqual(3);

    const atlassian = contracts.data.find((contract) => contract.contractNumber === "CTR-AT-2025-014");
    expect(atlassian).toMatchObject({
      publisherName: "Atlassian",
      licenseCount: 1,
      documentCount: 2,
    });
    expect(atlassian.folders.find((folder) => folder.name === "Signed agreement")).toMatchObject({
      documentCount: 1,
    });

    const linked = await demoRequest(`/api/contracts/${atlassian.id}/licenses`, { method: "GET" });
    expect(linked.error).toBeNull();
    expect(linked.data).toHaveLength(1);
    expect(linked.data[0]).toMatchObject({
      id: 1,
      publisherName: "Atlassian",
      expirationStatus: "expiring",
    });

    const documents = await demoRequest(`/api/contracts/${atlassian.id}/documents`, { method: "GET" });
    expect(documents.error).toBeNull();
    expect(documents.data.map((doc) => doc.originalFilename)).toContain("Atlassian signed agreement.pdf");
  });

  it("mutates contracts, folders, and document metadata in memory", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const created = await demoRequest("/api/contracts", {
      method: "POST",
      body: JSON.stringify({
        contract_number: "CTR-DEMO-NEW",
        publisher_name: "Demo Publisher",
        notes: "Created during the demo.",
      }),
    });
    expect(created.error).toBeNull();
    expect(created.data.licenseCount).toBe(0);

    const folder = await demoRequest(`/api/contracts/${created.data.id}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "Commercials" }),
    });
    expect(folder.error).toBeNull();
    expect(folder.data.name).toBe("Commercials");

    const formData = new FormData();
    formData.append("file", new File(["demo"], "commercials.txt", { type: "text/plain" }));
    const uploaded = await demoRequest(`/api/contracts/${created.data.id}/folders/${folder.data.id}/documents`, {
      method: "POST",
      body: formData,
    });
    expect(uploaded.error).toBeNull();
    expect(uploaded.data).toMatchObject({
      folderId: folder.data.id,
      originalFilename: "commercials.txt",
    });

    const blockedDelete = await demoRequest(`/api/contracts/${created.data.id}/folders/${folder.data.id}`, {
      method: "DELETE",
    });
    expect(blockedDelete.error).toMatch(/contains documents/i);

    const removedDoc = await demoRequest(`/api/contracts/${created.data.id}/documents/${uploaded.data.id}`, {
      method: "DELETE",
    });
    expect(removedDoc.error).toBeNull();

    const removedFolder = await demoRequest(`/api/contracts/${created.data.id}/folders/${folder.data.id}`, {
      method: "DELETE",
    });
    expect(removedFolder.error).toBeNull();
  });

  it("renames linked license contract numbers when contract number changes", async () => {
    await demoRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const updated = await demoRequest("/api/contracts/301", {
      method: "PUT",
      body: JSON.stringify({
        contract_number: "CTR-AT-2026-RENAMED",
        publisher_name: "Atlassian",
        notes: "Renamed in demo.",
      }),
    });
    expect(updated.error).toBeNull();
    expect(updated.data.licenseCount).toBe(1);

    const license = await demoRequest("/api/licenses/1", { method: "GET" });
    expect(license.data.contractNumber).toBe("CTR-AT-2026-RENAMED");
  });

  it("unknown routes fail soft with a demo message", async () => {
    const { data, error } = await demoRequest("/api/backup/trigger", { method: "POST" });
    expect(data).toBeNull();
    expect(error).toMatch(/demo/i);
  });
});

import { expect, test } from "@playwright/test";
import { apiGet, apiPost, apiSend, findLicense } from "./helpers.js";

const DESCRIPTION = "E2E CSV Round Trip";

test("a license exported with Export Full Data comes back unchanged through the native import", async ({ page }, testInfo) => {
  // Setup through the API: a license with an entered line total, a manual PO total,
  // per-unit maintenance pricing and a PO number (which receives a PO line).
  const created = await apiPost(page, "/api/licenses", {
    publisherName: "E2E Publisher",
    softwareDescription: DESCRIPTION,
    licenseType: "perpetual",
    licenseMetric: "per_user",
    quantity: "5",
    unitPrice: "10",
    totalPoPrice: "55",
    currency: "EUR",
    startDate: "2026-01-01",
    poNumber: "E2E-CSV-PO",
    supplier: "E2E Supplier",
    costCentre: "E2E-CC",
    budgetOwnerEmail: "owner@example.com",
    maintenanceCoverage: "included",
    maintenanceStartDate: "2026-01-01",
    maintenanceEndDate: "2027-01-01",
    maintenancePricingBasis: "per_unit",
    maintenanceQuantity: "5",
    maintenanceUnitPrice: "3",
    maintenanceCost: "15",
  });
  await apiPost(page, `/api/licenses/${created.id}/po-total-override`, { poTotalOverride: "999.5" });
  const original = await findLicense(page, DESCRIPTION);
  expect(original.poLineNumber).toBeGreaterThanOrEqual(1);
  expect(original.poTotalOverride).toBe("999.5");

  // Export the registry with every column.
  await page.goto("/licenses");
  await expect(page.getByText(DESCRIPTION).first()).toBeVisible(); // exports only what the table has loaded
  await page.getByRole("button", { name: "Export CSV" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export Full Data/ }).click();
  const download = await downloadPromise;
  const csvPath = testInfo.outputPath("registry-full.csv");
  await download.saveAs(csvPath);

  // Remove the license, then import the exported file.
  const removed = await apiSend(page, "DELETE", `/api/licenses/${original.id}`);
  expect(removed.ok(), `DELETE -> ${removed.status()}`).toBeTruthy();
  expect(await findLicense(page, DESCRIPTION)).toBeNull();

  await page.goto("/");
  await page.getByRole("button", { name: "Import" }).or(page.getByRole("link", { name: "Import" })).first().click();
  await page.locator('input[type="file"]').setInputFiles(csvPath);
  const importButton = page.getByRole("button", { name: /^Import \d+ licenses?$/ });
  await expect(importButton).toBeVisible();
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await expect(page.getByText("Import complete")).toBeVisible();

  const restored = await findLicense(page, DESCRIPTION);
  expect(restored, "the deleted license came back").not.toBeNull();
  expect(restored.poNumber).toBe(original.poNumber);
  // A PO line number is never reused: the number freed by the deletion stays retired.
  expect(restored.poLineNumber).toBeGreaterThan(original.poLineNumber);
  expect(restored.poTotalOverride).toBe(original.poTotalOverride);
  expect(Number(restored.totalPoPrice)).toBe(Number(original.totalPoPrice));
  expect(restored.maintenancePricingBasis).toBe("per_unit");
  expect(Number(restored.maintenanceQuantity)).toBe(5);
  expect(Number(restored.maintenanceUnitPrice)).toBe(3);
  expect(Number(restored.maintenanceCost)).toBe(15);
  expect(restored.maintenanceEndDate).toBe("2027-01-01");
});

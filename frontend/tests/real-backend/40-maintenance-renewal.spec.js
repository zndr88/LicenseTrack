import { expect, test } from "@playwright/test";
import { apiGet, fillLicenseBasics, isoDateFromToday, openAddLicense, openDetailSection, openLicense, saveAndGetLicense } from "./helpers.js";

const DESCRIPTION = "E2E Maintenance Renewal";
// The workbench row and the "renewal in progress" alert depend on the maintenance
// end being near today, so the dates are computed, never fixed.
const MAINTENANCE_START = isoDateFromToday(-345);
const MAINTENANCE_END = isoDateFromToday(20);

test("starting a maintenance renewal creates a sourcing request and blocks retiring the license", async ({ page }) => {
  // A perpetual whose included maintenance ends soon shows up on the renewal workbench.
  const dialog = await openAddLicense(page);
  await fillLicenseBasics(dialog, {
    publisher: "E2E Publisher",
    supplier: "E2E Supplier",
    costCentre: "E2E-CC",
    budgetOwner: "owner@example.com",
    description: DESCRIPTION,
    type: "perpetual",
    startDate: MAINTENANCE_START,
    quantity: 2,
    unitPrice: 300,
  });
  await dialog.locator("#inv-maintenance-coverage").selectOption("included");
  await dialog.locator("#inv-maintenance-start").fill(MAINTENANCE_START);
  await dialog.locator("#inv-maintenance-end").fill(MAINTENANCE_END);
  await dialog.locator("#inv-maintenance-cost").fill("90");
  const license = await saveAndGetLicense(page, dialog, DESCRIPTION);

  // Start the renewal from the workbench.
  await page.getByRole("link", { name: "Renewals" }).or(page.getByRole("button", { name: "Renewals" })).first().click();
  const started = page.waitForResponse((res) => res.url().includes(`/api/licenses/${license.id}/`) && res.request().method() === "POST");
  await page.getByRole("button", { name: `Start maintenance renewal for ${DESCRIPTION}` }).click();
  const response = await started;
  expect(response.status(), await response.text()).toBeLessThan(300);

  // A sourcing request now exists for the license, and the alert says a renewal is in progress.
  const requests = await apiGet(page, "/api/sourcing/requests");
  expect(requests.some((request) => (request.items ?? []).some((item) => item.maintenanceParentLicenseId === license.id))).toBeTruthy();
  const notifications = await apiGet(page, "/api/notifications");
  const alerts = JSON.stringify(notifications);
  expect(alerts).toContain("renewal is in progress");

  // Retiring the license is refused until the renewal is cancelled.
  await openLicense(page, license.id);
  await openDetailSection(page, "Completeness & Flags");
  const retire = page.locator(".dp-toggle-row", { hasText: "Retired License" }).getByRole("switch");
  const refused = page.waitForResponse((res) => /\/api\/licenses\/\d+/.test(res.url()) && ["PUT", "PATCH"].includes(res.request().method()));
  await retire.click();
  const refusal = await refused;
  expect(refusal.status()).toBe(409);
  expect(await refusal.text()).toContain("Cancel the renewal first");
  await expect(page.getByText(/Cancel the renewal first/)).toBeVisible();
});

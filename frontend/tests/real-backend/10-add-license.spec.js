import { expect, test } from "@playwright/test";
import { fillLicenseBasics, openAddLicense, saveAndGetLicense } from "./helpers.js";

const REQUIRED = { publisher: "E2E Publisher", supplier: "E2E Supplier", costCentre: "E2E-CC", budgetOwner: "owner@example.com" };

test("Add License: perpetual with included maintenance keeps the entered maintenance term", async ({ page }) => {
  const dialog = await openAddLicense(page);
  await fillLicenseBasics(dialog, {
    ...REQUIRED,
    description: "E2E Perpetual Included",
    type: "perpetual",
    startDate: "2026-01-01",
    quantity: 5,
    unitPrice: 100,
  });
  await dialog.locator("#inv-maintenance-coverage").selectOption("included");
  await dialog.locator("#inv-maintenance-start").fill("2026-01-01");
  await dialog.locator("#inv-maintenance-end").fill("2027-01-01");
  await dialog.locator("#inv-maintenance-cost").fill("250");
  await dialog.locator("#inv-purchase-date").fill("2026-01-05");

  const license = await saveAndGetLicense(page, dialog, "E2E Perpetual Included");
  expect(license.licenseType).toBe("perpetual");
  expect(license.maintenanceCoverage).toBe("included");
  expect(license.maintenanceStartDate).toBe("2026-01-01");
  expect(license.maintenanceEndDate).toBe("2027-01-01");
  expect(Number(license.maintenanceCost)).toBe(250);
  expect(license.purchaseDate).toMatch(/^2026-01-05/);
});

test("Add License: perpetual with separately tracked maintenance", async ({ page }) => {
  const dialog = await openAddLicense(page);
  await fillLicenseBasics(dialog, {
    ...REQUIRED,
    description: "E2E Perpetual Separate",
    type: "perpetual",
    startDate: "2026-01-01",
    quantity: 3,
    unitPrice: 40,
  });
  await dialog.locator("#inv-maintenance-coverage").selectOption("separately_tracked");

  const license = await saveAndGetLicense(page, dialog, "E2E Perpetual Separate");
  expect(license.licenseType).toBe("perpetual");
  expect(license.maintenanceCoverage).toBe("separately_tracked");
  expect(license.hasMaintenance).toBeFalsy();
});

test("Add License: subscription starts with included maintenance", async ({ page }) => {
  const dialog = await openAddLicense(page);
  await fillLicenseBasics(dialog, {
    ...REQUIRED,
    description: "E2E Subscription",
    type: "subscription",
    startDate: "2026-02-01",
    endDate: "2027-02-01",
    quantity: 10,
    unitPrice: 12,
  });

  const license = await saveAndGetLicense(page, dialog, "E2E Subscription");
  expect(license.licenseType).toBe("subscription");
  expect(license.maintenanceCoverage).toBe("included");
  expect(license.endDate).toBe("2027-02-01");
});

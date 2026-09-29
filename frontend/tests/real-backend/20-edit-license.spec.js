import { expect, test } from "@playwright/test";
import { findLicense, openDetailSection, openLicense, setNumberFormat } from "./helpers.js";

test("full edit stores notes, PO number and end date and assigns a PO line", async ({ page }) => {
  await page.goto("/");
  const before = await findLicense(page, "E2E Subscription");
  await openLicense(page, before.id);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#license-edit-po").fill("E2E-EDIT-PO");
  await page.locator("#license-edit-end-date").fill("2027-06-30");
  await page.locator("#license-edit-notes").fill("Edited through the real form");
  const saved = page.waitForResponse((res) => /\/api\/licenses\/\d+$/.test(res.url()) && res.request().method() === "PUT");
  await page.getByRole("button", { name: "Save Changes" }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBeLessThan(300);

  const after = await findLicense(page, "E2E Subscription");
  expect(after.poNumber).toBe("E2E-EDIT-PO");
  expect(after.endDate).toBe("2027-06-30");
  expect(after.notes).toBe("Edited through the real form");
  expect(after.poLineNumber).toBeGreaterThanOrEqual(1);
});

test("inline edit keeps 0,125 as 0.125 under a comma-decimal number format", async ({ page }) => {
  await setNumberFormat(page, "de-DE");
  try {
    await page.goto("/");
    const license = await findLicense(page, "E2E Subscription");
    await openLicense(page, license.id);
    await openDetailSection(page, "Details");
    await page.getByRole("button", { name: "Edit unit price" }).click();
    await page.locator("#field-edit-value").fill("0,125");
    const saved = page.waitForResponse((res) => res.url().includes("/field") && res.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBeLessThan(300);

    const after = await findLicense(page, "E2E Subscription");
    expect(Number(after.unitPrice)).toBe(0.125);
  } finally {
    await setNumberFormat(page, "en-US");
  }
});

async function editUnitPrice(page, typed) {
  await page.goto("/");
  const license = await findLicense(page, "E2E Subscription");
  await openLicense(page, license.id);
  await openDetailSection(page, "Details");
  await page.getByRole("button", { name: "Edit unit price" }).click();
  await page.locator("#field-edit-value").fill(typed);
  await page.locator("#field-edit-value").blur();
}

test("a price typed with thousands separators is stored as typed", async ({ page }) => {
  await editUnitPrice(page, "2,443.00");
  const saved = page.waitForResponse((res) => res.url().includes("/field") && res.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBeLessThan(300);

  const after = await findLicense(page, "E2E Subscription");
  expect(Number(after.unitPrice)).toBe(2443);
});

test("a price in another number format is refused with a message, not changed", async ({ page }) => {
  await setNumberFormat(page, "de-DE");
  try {
    const before = await findLicense(page, "E2E Subscription");
    await editUnitPrice(page, "2,443.00");
    await expect(page.getByRole("alert").filter({ hasText: /not a valid number/i })).toBeVisible();
    let patched = false;
    page.on("request", (req) => {
      if (req.url().includes("/field") && req.method() === "PATCH") patched = true;
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Fix the number above before saving.")).toBeVisible();
    expect(patched).toBe(false);

    const after = await findLicense(page, "E2E Subscription");
    expect(after.unitPrice).toBe(before.unitPrice);
  } finally {
    await setNumberFormat(page, "en-US");
  }
});

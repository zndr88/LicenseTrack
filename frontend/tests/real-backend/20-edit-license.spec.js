import { expect, test } from "@playwright/test";
import { apiGet, findLicense, openDetailSection, openLicense, setNumberFormat } from "./helpers.js";

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

test("switching to another license mid-edit asks first and leaves both licenses unchanged", async ({ page }) => {
  await page.goto("/");
  const edited = await findLicense(page, "E2E Subscription");
  const before = await apiGet(page, "/api/licenses");
  let updates = 0;
  page.on("request", (req) => {
    if (/\/api\/licenses\/\d+/.test(req.url()) && ["PUT", "PATCH"].includes(req.method())) updates += 1;
  });

  await openLicense(page, edited.id);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#license-edit-notes").fill("Typed but never saved");

  const otherRow = page.getByRole("row").filter({ hasText: "E2E Perpetual Included" }).first();
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });

  await otherRow.getByText("E2E Perpetual Included").first().click();
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator("#license-edit-notes")).toHaveValue("Typed but never saved");
  await expect(page).toHaveURL(new RegExp(`/licenses/${edited.id}$`));

  await otherRow.getByText("E2E Perpetual Included").first().click();
  await discardDialog.getByRole("button", { name: "Discard" }).click();
  await expect(page).not.toHaveURL(new RegExp(`/licenses/${edited.id}$`));
  await expect(page).toHaveURL(/\/licenses\/\d+$/);
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();

  expect(updates).toBe(0);
  expect(await apiGet(page, "/api/licenses")).toEqual(before);
});

test("Escape closes a dialog first, asks about unsaved edits, then closes the panel", async ({ page }) => {
  await page.goto("/");
  const license = await findLicense(page, "E2E Subscription");
  await openLicense(page, license.id);
  const panelUrl = new RegExp(`/licenses/${license.id}(#.*)?$`);

  // A small dialog on top of the panel: Escape closes only the dialog.
  await openDetailSection(page, "Details");
  await page.getByRole("button", { name: "Edit unit price" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(panelUrl);

  // An edit with changes: Escape asks, a second Escape returns to the form.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#license-edit-notes").fill("Typed but never saved");
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeHidden();
  await expect(page.locator("#license-edit-notes")).toHaveValue("Typed but never saved");

  // Discarding closes the panel; the license is unchanged.
  await page.keyboard.press("Escape");
  await discardDialog.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/\/licenses$/);
  await expect(page.getByText("License Details")).toBeHidden();
  expect((await findLicense(page, "E2E Subscription")).notes).toBe(license.notes);
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

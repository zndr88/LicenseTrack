import { expect } from "@playwright/test";

const APP_HEADER = { "X-LicenseTrack-Request": "1" };

export async function apiGet(page, path) {
  const res = await page.request.get(path);
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function apiSend(page, method, path, data) {
  const res = await page.request.fetch(path, { method, data, headers: APP_HEADER });
  return res;
}

export async function apiPost(page, path, data) {
  const res = await apiSend(page, "POST", path, data);
  expect(res.ok(), `POST ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

export async function apiPut(page, path, data) {
  const res = await apiSend(page, "PUT", path, data);
  expect(res.ok(), `PUT ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Finds a license by its software description. */
export async function findLicense(page, description) {
  const licenses = await apiGet(page, "/api/licenses");
  return licenses.find((license) => license.softwareDescription === description) ?? null;
}

/** Opens the Add License modal (Review License Data) with every section open. */
export async function openAddLicense(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add License" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Expand all" }).click();
  return dialog;
}

/**
 * Fills the Add License basics. `fields` keys map to the form's element ids;
 * omitted keys are left alone.
 */
export async function fillLicenseBasics(dialog, fields) {
  const { type, ...text } = fields;
  if (type) await dialog.locator("#inv-license-type").selectOption(type);
  const ids = {
    publisher: "#inv-publisher-name",
    description: "#inv-software-desc",
    startDate: "#inv-start-date",
    endDate: "#inv-end-date",
    poNumber: "#inv-po-number",
    quantity: "#inv-quantity",
    unitPrice: "#inv-unit-price",
    lineTotal: "#inv-total-price",
    supplier: "#inv-supplier",
    costCentre: "#inv-cost-centre",
    budgetOwner: "#inv-budget-owner",
    notes: "#inv-notes",
  };
  for (const [key, value] of Object.entries(text)) {
    if (!ids[key]) throw new Error(`Unknown license field "${key}"`);
    await dialog.locator(ids[key]).fill(String(value));
  }
}

/** Saves the Add License modal and returns the stored license. */
export async function saveAndGetLicense(page, dialog, description) {
  const created = page.waitForResponse(
    (res) => res.url().includes("/api/licenses") && res.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Save License" }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBeLessThan(300);
  await expect(dialog).toBeHidden();
  const license = await findLicense(page, description);
  expect(license, `license "${description}" was saved`).not.toBeNull();
  return license;
}

/** Opens a license's detail panel by its id (deep link). */
export async function openLicense(page, id) {
  await page.goto(`/licenses/${id}`);
  await expect(page.getByText("License Details")).toBeVisible();
}

/** Opens a collapsed detail-panel section such as "Details" or "Notes". */
export async function openDetailSection(page, name) {
  const header = page.getByRole("button", { name, exact: true });
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
}

/** Sets the signed-in user's number format on the Settings page ("en-US" or "de-DE"). */
export async function setNumberFormat(page, locale) {
  await page.goto("/settings");
  const select = page.locator("#settings-number-format");
  const header = page.getByRole("button", { name: /^Appearance/i });
  await expect(header).toBeVisible();
  // A collapsed section still counts as visible and accepts selectOption, but
  // its Save button cannot be clicked. Retry until the section reports open.
  await expect(async () => {
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass();
  await expect(select).toBeVisible();
  await select.selectOption(locale);
  await expect(select).toHaveValue(locale);
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const saved = page.waitForResponse((res) => res.url().endsWith("/api/settings") && res.request().method() === "PUT");
  await page.locator(".setsec", { has: select }).getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
}

/** YYYY-MM-DD for today plus `days` (negative for the past), for dates that must stay near today. */
export function isoDateFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

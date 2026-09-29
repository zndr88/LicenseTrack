import { expect, test } from "@playwright/test";
import { apiGet, openDetailSection, openLicense } from "./helpers.js";

const PO_NUMBER = "E2E-PO-1";

test("sourcing request with two lines converts to a pending order and then to licenses", async ({ page }) => {
  // 1. Create a sourcing request with two lines through the form.
  await page.goto("/sourcing");
  await page.getByRole("button", { name: "Add Request" }).click();
  const request = page.getByRole("dialog");
  await request.getByRole("button", { name: "Expand all" }).click();
  await request.locator("#si-publisher").fill("E2E Vendor");
  await request.locator("#si-software-desc").fill("E2E Sourced One");
  await request.locator("#si-license-type").selectOption("subscription");
  await request.locator("#si-quantity").fill("4");
  await request.locator("#si-unit-price").fill("25");
  await request.locator("#si-supplier").fill("E2E Reseller");
  await request.locator("#si-cost-centre").fill("E2E-CC");
  await request.locator("#si-budget-owner").fill("owner@example.com");
  await request.locator("#si-start-date").fill("2026-03-01");
  await request.locator("#si-end-date").fill("2027-03-01");

  await request.getByRole("button", { name: "Add additional license line" }).click();
  await request.locator('[id^="sourcing-line-"][id$="-publisher"]').fill("E2E Vendor");
  await request.locator('[id^="sourcing-line-"][id$="-software"]').fill("E2E Sourced Two");
  await request.locator('[id^="sourcing-line-"][id$="-license-type"]').selectOption("subscription");
  await request.locator('[id^="sourcing-line-"][id$="-quantity"]').fill("2");
  await request.locator('[id^="sourcing-line-"][id$="-unit-price"]').fill("50");

  const created = page.waitForResponse((res) => res.url().includes("/api/sourcing") && res.request().method() === "POST");
  await request.getByRole("button", { name: "Save 2 lines" }).click();
  const createdResponse = await created;
  expect(createdResponse.status(), await createdResponse.text()).toBeLessThan(300);
  await expect(request).toBeHidden();

  const requests = await apiGet(page, "/api/sourcing/requests");
  const sourcing = requests.find((r) => (r.items ?? []).some((i) => i.softwareDescription === "E2E Sourced One"));
  expect(sourcing, "the sourcing request was saved").toBeTruthy();
  expect(sourcing.items).toHaveLength(2);
  expect(sourcing.items.map((i) => i.softwareDescription).sort()).toEqual(["E2E Sourced One", "E2E Sourced Two"]);

  // 2. Convert it to a new pending order.
  await page.reload();
  await page.getByRole("row", { name: /E2E Reseller/ }).getByRole("button", { name: "Convert", exact: true }).click();
  const convert = page.getByRole("dialog");
  await convert.locator("#cs-po-number").fill(PO_NUMBER);
  const converted = page.waitForResponse((res) => res.url().includes("/api/sourcing") && res.request().method() === "POST");
  await convert.getByRole("button", { name: "Convert", exact: true }).click();
  const convertedResponse = await converted;
  expect(convertedResponse.status(), await convertedResponse.text()).toBeLessThan(300);

  // 3. The pending order carries PO lines 1 and 2.
  const orders = await apiGet(page, "/api/pending-orders");
  const order = orders.find((o) => o.poNumber === PO_NUMBER);
  expect(order, "the pending order was created").toBeTruthy();
  expect(order.items.map((i) => i.poLineNumber).sort()).toEqual([1, 2]);
  await page.goto("/pending-orders");
  await page.getByText(PO_NUMBER).first().click();
  await expect(page.locator("[data-po-item-row]")).toHaveCount(2);
  await expect(page.locator("[data-po-item-row]").first().locator("td.mono")).toHaveText("1");

  // 4. Convert all lines. Line 2 was entered without dates, so the form asks for them.
  await page.getByRole("row", { name: new RegExp(PO_NUMBER) }).getByRole("button", { name: "Convert", exact: true }).click();
  const convertAll = page.getByRole("dialog");
  await convertAll.getByRole("button", { name: "Expand all" }).click();
  await convertAll.locator("#ca-start-date-1").fill("2026-03-01");
  await convertAll.locator("#ca-end-date-1").fill("2027-03-01");
  await expect(convertAll.getByText("2 of 2 items ready")).toBeVisible();
  const licensesCreated = page.waitForResponse((res) => res.url().includes("/api/pending-orders/") && res.request().method() === "POST");
  await convertAll.getByRole("button", { name: /Confirm & Create Licenses/ }).click();
  const licensesResponse = await licensesCreated;
  expect(licensesResponse.status(), await licensesResponse.text()).toBeLessThan(300);

  // 5. The licenses exist with the PO number, and the detail panel shows the PO line.
  const licenses = await apiGet(page, "/api/licenses");
  const sourced = licenses.filter((l) => l.softwareDescription.startsWith("E2E Sourced"));
  expect(sourced).toHaveLength(2);
  for (const license of sourced) expect(license.poNumber).toBe(PO_NUMBER);
  expect(sourced.map((l) => l.poLineNumber).sort()).toEqual([1, 2]);
  const first = sourced.find((l) => l.poLineNumber === 1);
  await openLicense(page, first.id);
  await openDetailSection(page, "Key Dates & Contract");
  await expect(page.getByText("· LINE 1")).toBeVisible();
});

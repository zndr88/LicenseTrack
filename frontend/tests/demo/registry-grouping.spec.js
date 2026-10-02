import { expect, test } from "@playwright/test";

async function openDemoRegistry(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sign in locally/i }).click();
  await expect(page.getByRole("heading", { name: /license overview/i })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Atlassian" }).first()).toBeVisible();
}

async function saveView(page, name) {
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.getByPlaceholder("View name...").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function loadView(page, name) {
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.locator(".lp-view-load", { hasText: name }).click();
}

test("group the Registry by PO then publisher, and keep it in a saved view", async ({ page }) => {
  await openDemoRegistry(page);

  await page.getByRole("button", { name: "Group columns" }).click();
  await page.getByLabel("Add grouping").selectOption("poNumber");
  await page.getByLabel("Add grouping").selectOption("publisher");

  const po = page.getByRole("button", { name: /PO # · PO-2025-0955/ });
  await expect(po).toHaveAttribute("aria-expanded", "false");
  const poRow = page.locator("tr.lp-group-row").filter({ has: po });
  await expect(poRow).toContainText(/lines/);
  await expect(poRow).toContainText("Total PO Value");

  await po.click();
  await expect(po).toHaveAttribute("aria-expanded", "true");
  const publisher = page.getByRole("button", { name: /Publisher · Arctic Wolf/ });
  await expect(publisher).toBeVisible();
  await publisher.click();
  await expect(page.getByRole("row").filter({ hasText: "Arctic Wolf" }).filter({ hasNot: page.locator(".lp-group-cell") }).first()).toBeVisible();

  // Save the view, clear the grouping, load the view: the grouping comes back.
  await saveView(page, "By PO");
  await page.getByRole("button", { name: "Remove grouping by Publisher" }).click();
  await page.getByRole("button", { name: "Remove grouping by PO #" }).click();
  await expect(page.getByRole("button", { name: /PO # · / })).toHaveCount(0);
  await loadView(page, "By PO");
  await expect(page.getByRole("button", { name: /PO # · PO-2025-0955/ })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("demo supports the renewal procurement golden path", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Demo credentials are prefilled")).toBeVisible();
  await page.getByRole("button", { name: /sign in locally/i }).click();

  await expect(page.getByText("Demo mode - sample data")).toBeVisible();
  await expect(page.getByRole("heading", { name: /license overview/i })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Atlassian" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Renewals" }).click();
  await expect(page.getByRole("heading", { name: /renewal workbench/i })).toBeVisible();
  await expect(page.getByText("Jira Software Data Center")).toBeVisible();
  await page.getByRole("button", { name: /initiate renewal for jira software data center/i }).click();
  await expect(page.getByRole("button", { name: /open sourcing item for jira software data center/i })).toBeVisible();

  await page.getByRole("button", { name: "Sourcing Overview" }).click();
  await expect(page.getByRole("heading", { name: /sourcing overview/i })).toBeVisible();
  await page.getByRole("button", { name: /^Convert$/ }).first().click();
  const sourcingDialog = page.getByRole("dialog", { name: /convert to pending order/i });
  await expect(sourcingDialog).toBeVisible();
  await page.getByLabel(/po number/i).fill("PO-DEMO-RENEWAL");
  await sourcingDialog.getByRole("button", { name: /^Convert$/ }).click();
  await expect(page.getByText(/Converted to Pending Order PO-DEMO-RENEWAL/i)).toBeVisible();

  await page.getByRole("button", { name: /Pending Orders/ }).first().click();
  await expect(page.getByRole("heading", { name: /pending orders/i })).toBeVisible();
  await expect(page.getByText("PO-DEMO-RENEWAL")).toBeVisible();
  await page.getByRole("button", { name: /^Convert$/ }).first().click();
  await expect(page.getByRole("heading", { name: /renew license - PO-DEMO-RENEWAL/i })).toBeVisible();
  await page.getByRole("button", { name: /confirm & renew license/i }).click();
  await expect(page.getByText(/1 license renewed/i)).toBeVisible();

  await page.getByRole("button", { name: "License Overview" }).click();
  await expect(page.getByRole("heading", { name: /license overview/i })).toBeVisible();
});

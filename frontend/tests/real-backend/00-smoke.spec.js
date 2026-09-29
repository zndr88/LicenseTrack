import { expect, test } from "@playwright/test";

test("the signed-in app loads against the real backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  const health = await page.request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});

import { expect, test } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:5177";
const TIMEOUT_MINUTES = 30;
// Stepping a fake clock through 30 minutes takes a while when workers share the machine.
test.describe.configure({ timeout: 120_000 });

const USER = {
  id: 1, username: "admin", name: "Admin User", avatar: "AD", role: "admin",
  allow_downloads: true, auth_provider: "local", is_break_glass_admin: false, must_change_password: false,
};

// One in-memory backend session shared by every tab of the browser context.
async function mockBackend(context, state) {
  const cors = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type, authorization, x-licensetrack-request",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, json: body });
    if (pathname === "/api/auth/session") {
      return json(state.loggedIn
        ? { authenticated: true, expires_in: TIMEOUT_MINUTES * 60, coordination_id: "s1", session_timeout: TIMEOUT_MINUTES, user: USER }
        : { authenticated: false, user: null });
    }
    if (pathname === "/api/auth/mode") return json({ oidc_enabled: false, oidc_available: false });
    if (pathname === "/api/auth/refresh" && method === "POST") {
      state.refreshes += 1;
      return json({ access_token: "x.eyJzZXNzaW9uX2lkIjoiczEifQ.y", token_type: "bearer", expires_in: TIMEOUT_MINUTES * 60 });
    }
    if (pathname === "/api/auth/logout") {
      state.loggedIn = false;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (pathname === "/api/settings") {
      return json({ theme: "gray", saved_views: [], visible_in_list: {}, visible_in_detail: {}, column_order: [], number_format_locale: "en-US", date_format: "YYYY-MM-DD", display_currency: "EUR" });
    }
    if (pathname === "/api/settings/global" || pathname === "/api/settings/global/public") {
      return json({ mandatory_fields: {}, notification_days: 30, notification_send_hour: 7, allowed_email_domains: "", email_enabled: false, session_timeout: TIMEOUT_MINUTES });
    }
    if (pathname === "/api/custom-fields/values" || pathname === "/api/custom-fields/values/") return json({ values: [] });
    return json([]);
  });
}

async function openTwoTabs(browser) {
  const context = await browser.newContext();
  const state = { loggedIn: true, refreshes: 0 };
  await mockBackend(context, state);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) await tab.clock.install({ time: new Date("2026-01-01T10:00:00Z") });
  await tabA.goto("/");
  await tabB.goto("/");
  for (const tab of [tabA, tabB]) {
    await expect(tab.getByRole("heading", { name: /license overview/i })).toBeVisible();
  }
  return { context, state, tabA, tabB };
}

test("an active tab refreshes before expiry, and logout in one tab reaches the other", async ({ browser }) => {
  const { context, state, tabA, tabB } = await openTwoTabs(browser);

  // Active user in tab A: input every few minutes keeps the session alive; a refresh
  // happens before the 30-minute deadline.
  for (let minute = 0; minute < 29; minute += 1) {
    if (minute % 4 === 0) await tabA.keyboard.press("Shift");
    await tabA.clock.runFor(60_000);
    await tabB.clock.runFor(60_000);
  }
  await expect.poll(() => state.refreshes).toBeGreaterThan(0);
  await expect(tabA.getByRole("heading", { name: /license overview/i })).toBeVisible();

  await tabA.getByRole("button", { name: /open user menu/i }).click();
  await tabA.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(tabA.getByRole("button", { name: /sign in locally/i })).toBeVisible();
  await expect(tabB.getByRole("button", { name: /sign in locally/i })).toBeVisible();
  await context.close();
});

test("an idle session ends in every tab", async ({ browser }) => {
  const { context, tabA, tabB } = await openTwoTabs(browser);

  for (let minute = 0; minute <= TIMEOUT_MINUTES + 1; minute += 1) {
    await tabA.clock.runFor(60_000);
    await tabB.clock.runFor(60_000);
  }

  await expect(tabA.getByRole("button", { name: /sign in locally/i })).toBeVisible();
  await expect(tabB.getByRole("button", { name: /sign in locally/i })).toBeVisible();
  await context.close();
});

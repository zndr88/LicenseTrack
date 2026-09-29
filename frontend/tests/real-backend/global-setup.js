import { chromium, request } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { runCredentials } from "./credentials.js";

const APP_HEADER = { "X-LicenseTrack-Request": "1" };

// Signs in as the seeded admin, completes the forced password change, then
// signs in through the real login screen and saves the browser state.
export default async function globalSetup(config) {
  const { ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, ADMIN_PASSWORD } = runCredentials();
  const baseURL = config.projects[0].use.baseURL;
  const api = await request.newContext({ baseURL, extraHTTPHeaders: APP_HEADER });
  const login = await api.post("/api/auth/login", {
    data: { username: ADMIN_USERNAME, password: INITIAL_ADMIN_PASSWORD },
  });
  if (login.ok()) {
    const change = await api.post("/api/auth/change-password", {
      data: { current_password: INITIAL_ADMIN_PASSWORD, new_password: ADMIN_PASSWORD },
    });
    if (!change.ok()) throw new Error(`change-password failed: ${change.status()} ${await change.text()}`);
  } else {
    throw new Error(`initial admin login failed: ${login.status()}`);
  }
  await api.dispose();

  mkdirSync("tests/real-backend/.auth", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.getByLabel("Username").waitFor({ state: "detached" });
  await page.context().storageState({ path: "tests/real-backend/.auth/admin.json" });
  await browser.close();
}

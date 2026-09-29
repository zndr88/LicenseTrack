import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCredentials } from "./tests/real-backend/credentials.js";

const { INITIAL_ADMIN_PASSWORD, JWT_SECRET } = runCredentials();

const BACKEND_PORT = 8765;
const FRONTEND_PORT = 5178;
const workDir = mkdtempSync(join(tmpdir(), "licensetrack-e2e-"));
const python = process.env.E2E_PYTHON || (process.platform === "win32" ? "py -3.12" : "python");

// Runs the real frontend against a real backend with a fresh SQLite database
// and strict request fields, so a form and the server that disagree fail here.
export default defineConfig({
  testDir: "./tests/real-backend",
  globalSetup: "./tests/real-backend/global-setup.js",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // one shared database; specs run in file order
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    storageState: "tests/real-backend/.auth/admin.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: `sqlite+aiosqlite:///${join(workDir, "e2e.db").replaceAll("\\", "/")}`,
        STORAGE_PATH: join(workDir, "storage"),
        BACKUP_LOCATION: join(workDir, "backups"),
        PLUGIN_STORAGE_PATH: join(workDir, "plugins"),
        JWT_SECRET,
        ADMIN_PASSWORD: INITIAL_ADMIN_PASSWORD,
        STRICT_REQUEST_FIELDS: "true",
        SESSION_COOKIE_SECURE: "false",
        CORS_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT}`,
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
    },
  ],
});

// Random, per-run values for the throwaway instance started by
// playwright.real.config.js. Nothing is stored: the config generates them
// once and hands them to the global setup through the environment.
import { randomBytes } from "node:crypto";

const fresh = (bytes) => randomBytes(bytes).toString("base64url");

export function runCredentials() {
  if (!process.env.E2E_INITIAL_ADMIN_PASSWORD) {
    // Mixed case, digit and symbol so the backend's password rules accept them.
    process.env.E2E_INITIAL_ADMIN_PASSWORD = `Init-${fresh(18)}-9a`;
    process.env.E2E_ADMIN_PASSWORD = `Admin-${fresh(18)}-9a`;
    process.env.E2E_JWT_SECRET = fresh(48);
  }
  return {
    ADMIN_USERNAME: "admin",
    INITIAL_ADMIN_PASSWORD: process.env.E2E_INITIAL_ADMIN_PASSWORD,
    ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
    JWT_SECRET: process.env.E2E_JWT_SECRET,
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSessionExpiry, rememberSessionExpiry } from "../api/client.js";

describe("session deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("is measured on the browser clock from the seconds remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z")); // browser clock (the server may differ)
    rememberSessionExpiry(1800);
    expect(getSessionExpiry()).toBe(Date.parse("2026-01-01T10:30:00Z"));
  });

  it("is written only by rememberSessionExpiry", () => {
    const root = join(__dirname, "..");
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== "__tests__") walk(path); continue; }
        if (!/\.(js|jsx)$/.test(name)) continue;
        const text = readFileSync(path, "utf8");
        if (/setItem\(\s*sessionCoordinationKey\("expiry"\)/.test(text) && !path.endsWith(join("api", "client.js"))) {
          offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

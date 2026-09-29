import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionExpiry, rememberSessionExpiry } from "../api/client.js";

// Every non-test source file, as raw text.
const sources = import.meta.glob(["../**/*.{js,jsx}", "!../__tests__/**", "!../**/__tests__/**"], {
  query: "?raw", import: "default", eager: true,
});

describe("session deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("is measured on the browser clock from the seconds remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z")); // browser clock (the server may differ)
    rememberSessionExpiry(1800);
    expect(getSessionExpiry()).toBe(Date.parse("2026-01-01T10:30:00Z"));
  });

  it("is written only by rememberSessionExpiry", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources)
      .filter(([path, text]) => /setItem\(\s*sessionCoordinationKey\("expiry"\)/.test(text) && !path.endsWith("api/client.js"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

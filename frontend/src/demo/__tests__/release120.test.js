import { beforeEach, describe, expect, it } from "vitest";
import { demoRequest } from "../router.js";
import { computeNotifications, resetStore, store } from "../store.js";
import { daysFromNow } from "../time.js";

const request = (path, method, body) => demoRequest(path, { method, body: JSON.stringify(body) });
const demoSources = import.meta.glob("../*.js", { query: "?raw", import: "default", eager: true });

describe("demo notice workflow parity", () => {
  it("keeps notice handling reset in one demo owner", () => {
    const copies = Object.entries(demoSources)
      .filter(([path]) => !path.endsWith("/store.js"))
      .filter(([, source]) => /\.noticeHandled(?:At|ByUserId)\s*=\s*null/.test(source))
      .map(([path]) => path);
    expect(copies).toEqual([]);
  });
  beforeEach(async () => {
    resetStore();
    await request("/api/auth/login", "POST", { username: "demo", password: "demo" });
  });

  it("refuses handling a missing notice date", async () => {
    const license = store.licenses[0];
    license.noticeDate = null;
    const result = await request(`/api/licenses/${license.id}/notice/handled`, "POST", {});
    expect(result.error).toBe("License has no notice date to mark handled");
    expect(license.noticeHandledAt).toBeNull();
  });

  it("rejects localized numeric text before writing or creating reference data", async () => {
    const before = store.licenses.length;
    const result = await request("/api/licenses", "POST", {
      publisherName: "Demo Invalid Numeric Vendor", softwareDescription: "Invalid price",
      licenseType: "subscription", licenseMetric: "per_user", quantity: "1", unitPrice: "1,5", currency: "EUR",
    });
    expect(result.error).toContain("plain decimal strings");
    expect(store.licenses).toHaveLength(before);
  });

  it.each(["PUT", "PATCH"])("%s rejects localized prices without changing the license", async (method) => {
    const license = store.licenses[0];
    const before = license.unitPrice;
    const result = await request(`/api/licenses/${license.id}${method === "PATCH" ? "/field" : ""}`, method,
      method === "PATCH" ? { field: "unitPrice", value: "1,5" } : { unitPrice: "1,5" });
    expect(result.error).toMatch(/plain decimal string/);
    expect(license.unitPrice).toBe(before);
  });

  it("marks a notice handled and suppresses its reminder", async () => {
    const license = store.licenses[0];
    license.noticeDate = daysFromNow(2);
    expect(computeNotifications().some((item) => item.license_id === license.id && item.type === "notice_due")).toBe(true);
    const result = await request(`/api/licenses/${license.id}/notice/handled`, "POST", {});
    expect(result.error).toBeNull();
    expect(result.data.noticeHandledAt).toBeTruthy();
    expect(result.data.noticeHandledByUserId).toBe(1);
    expect(computeNotifications().some((item) => item.license_id === license.id && item.type === "notice_due")).toBe(false);
  });

  it.each(["PUT", "PATCH"])("%s keeps unchanged notice handling and resets a changed or cleared date", async (method) => {
    const license = store.licenses[0];
    const original = daysFromNow(2);
    license.noticeDate = original;
    const update = (value) => request(`/api/licenses/${license.id}${method === "PATCH" ? "/field" : ""}`, method, method === "PATCH" ? { field: "noticeDate", value } : { noticeDate: value });
    for (const value of [original, daysFromNow(3), null]) {
      license.noticeDate = original;
      license.noticeHandledAt = "2026-10-01T12:00:00Z";
      license.noticeHandledByUserId = 1;
      const result = await update(value);
      expect(result.error).toBeNull();
      expect(result.data.noticeHandledAt).toBe(value === original ? "2026-10-01T12:00:00Z" : null);
      expect(result.data.noticeHandledByUserId).toBe(value === original ? 1 : null);
    }
  });
});

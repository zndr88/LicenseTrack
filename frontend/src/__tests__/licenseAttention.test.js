import { describe, expect, test } from "vitest";
import { getLicenseAttentionItems } from "../utils/licenseAttention.js";

function license(id, status, days, renewedToId = null) {
  return {
    id,
    renewedToId,
    expiration: { status, days },
  };
}

describe("getLicenseAttentionItems", () => {
  test("excludes expiring and expired licenses after a successor is secured", () => {
    const items = getLicenseAttentionItems([
      license(1, "expiring", 10, 11),
      license(2, "expired", -2, 12),
      license(3, "expiring", 20),
    ], new Set());

    expect(items.map((item) => item.id)).toEqual([3]);
  });

  test("keeps unresolved items ordered by expiry and honors dismissals", () => {
    const items = getLicenseAttentionItems([
      license(1, "expiring", 20),
      license(2, "expired", -3),
      license(3, "active", 90),
    ], new Set([1]));

    expect(items.map((item) => item.id)).toEqual([2]);
  });

  test("excludes a license whose retirement is already scheduled", () => {
    const scheduled = license(1, "expiring", 10);
    scheduled.retirementScheduled = true;

    expect(getLicenseAttentionItems([scheduled], new Set())).toEqual([]);
  });

  test.each(["expiring", "expired"])("includes a pending renewal that is %s", (status) => {
    const pending = license(1, status, status === "expired" ? -1 : 10);
    pending.lifecycleStatus = "pending_renewal";

    expect(getLicenseAttentionItems([pending], new Set())).toEqual([pending]);
  });
});

import { describe, expect, it } from "vitest";
import { expiryBreakdownText } from "../../utils/expiryBreakdown.js";

describe("expiryBreakdownText", () => {
  it("lists the non-zero parts after the total", () => {
    expect(expiryBreakdownText("expiring", 12, { renewalInProgress: 5, retiring: 1, notStarted: 6 }))
      .toBe("12 expiring · 5 renewal in progress · 1 retiring · 6 not started");
  });

  it("leaves zero parts out", () => {
    expect(expiryBreakdownText("expired", 3, { renewalInProgress: 0, retiring: 0, notStarted: 3 }))
      .toBe("3 expired · 3 not started");
  });

  it("returns null when there is nothing to break down", () => {
    expect(expiryBreakdownText("expired", 0, { renewalInProgress: 0, retiring: 0, notStarted: 0 })).toBeNull();
    expect(expiryBreakdownText("expiring", 4, null)).toBeNull();
  });
});

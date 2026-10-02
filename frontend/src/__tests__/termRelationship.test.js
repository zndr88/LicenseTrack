import { describe, expect, it } from "vitest";
import { termDateRelationship } from "../utils/termRelationship.js";

describe("termDateRelationship", () => {
  it("reports contiguous terms when the later term starts the day after", () => {
    expect(termDateRelationship({ endDate: "2026-12-31" }, { startDate: "2027-01-01" }))
      .toEqual({ tone: "ok", text: "Terms are contiguous" });
  });

  it("reports a gap when the later term starts more than a day later", () => {
    expect(termDateRelationship({ endDate: "2026-12-31" }, { startDate: "2027-01-04" }))
      .toEqual({ tone: "warning", text: "3-day gap between terms" });
  });

  it("reports an overlap when the later term starts before the earlier ends", () => {
    expect(termDateRelationship({ endDate: "2026-12-31" }, { startDate: "2026-12-29" }))
      .toEqual({ tone: "warning", text: "3-day overlap between terms" });
  });

  it("returns null when a date is missing", () => {
    expect(termDateRelationship({ endDate: "" }, { startDate: "2027-01-01" })).toBeNull();
    expect(termDateRelationship({ endDate: "2026-12-31" }, {})).toBeNull();
  });
});

describe("termLinkBlock", () => {
  const line = (id, overrides = {}) => ({ id, sourcingRequestId: 8, licenseType: "subscription", ...overrides });

  it("allows an earlier term to roll into a later one", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    const y1 = line(1, { startDate: "2026-01-01" });
    const y2 = line(2, { startDate: "2027-01-01" });
    expect(termLinkBlock(y1, y2, [y1, y2])).toBeNull();
  });

  it("refuses a later term as the predecessor of an earlier one", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    const y2 = line(2, { startDate: "2027-01-01" });
    const y3 = line(3, { startDate: "2028-01-01" });
    expect(termLinkBlock(y3, y2, [y2, y3])).toBe("order");
    expect(termLinkBlock(y2, y2, [y2])).toBe("self");
  });

  it("allows the link when a start date is missing", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    expect(termLinkBlock(line(1), line(2, { startDate: "2027-01-01" }), [])).toBeNull();
  });

  it("refuses a link that would close a loop", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    const y1 = line(1, { successorSourcingItemId: 2 });
    const y2 = line(2, { successorSourcingItemId: 3 });
    const y3 = line(3);
    expect(termLinkBlock(y3, y1, [y1, y2, y3])).toBe("loop");
  });

  it("refuses a predecessor that already rolls into another term", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    const y1 = line(1, { successorSourcingItemId: 9 });
    expect(termLinkBlock(y1, line(2), [y1])).toBe("linked");
    expect(termLinkBlock(line(1, { successorSourcingItemId: 2 }), line(2), [])).toBeNull();
  });

  it("refuses mixing maintenance and licenses, and a successor that already follows a license", async () => {
    const { termLinkBlock } = await import("../utils/termRelationship.js");
    expect(termLinkBlock(line(1, { licenseType: "maintenance" }), line(2), [])).toBe("type");
    expect(termLinkBlock(line(1), line(2, { renewalForLicenseId: 40 }), [])).toBe("follows_license");
    expect(termLinkBlock(line(1), line(2, { cotermPredecessorIds: [41] }), [])).toBe("follows_license");
  });
});

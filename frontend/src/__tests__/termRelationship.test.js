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

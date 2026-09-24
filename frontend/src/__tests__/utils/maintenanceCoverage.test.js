import { describe, expect, test } from "vitest";
import { coverageAfterTypeChange } from "../../utils/maintenanceCoverage.js";

describe("coverageAfterTypeChange", () => {
  test("untouched coverage follows the new type's default", () => {
    expect(coverageAfterTypeChange("unknown", "", "subscription")).toBe("included");
    expect(coverageAfterTypeChange("unknown", "", "perpetual")).toBe("unknown");
    expect(coverageAfterTypeChange("included", "subscription", "perpetual")).toBe("unknown");
    expect(coverageAfterTypeChange("unknown", "perpetual", "saas")).toBe("included");
    expect(coverageAfterTypeChange("not_applicable", "service", "subscription")).toBe("included");
  });

  test("a deliberate coverage choice is kept", () => {
    expect(coverageAfterTypeChange("included", "perpetual", "oem")).toBe("included");
    expect(coverageAfterTypeChange("not_applicable", "subscription", "saas")).toBe("not_applicable");
    expect(coverageAfterTypeChange("separately_tracked", "perpetual", "oem")).toBe("separately_tracked");
  });
});

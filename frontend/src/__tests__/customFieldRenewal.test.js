import { describe, expect, test } from "vitest";

import {
  filterCustomFieldDefinitionsForRenewal,
  getCustomFieldRenewalBehavior,
} from "../utils/customFieldRenewal.js";

const definitions = [
  { id: 1, renewalBehavior: "clear" },
  { id: 2, renewalBehavior: "copy" },
  { id: 3, renewalBehavior: "hide" },
];

describe("custom field renewal behavior", () => {
  test("keeps every custom field outside renewal workflows", () => {
    expect(filterCustomFieldDefinitionsForRenewal(definitions, false)).toBe(definitions);
  });

  test("removes hidden fields from renewal workflows", () => {
    expect(filterCustomFieldDefinitionsForRenewal(definitions, true).map((field) => field.id)).toEqual([1, 2]);
  });

  test("normalizes the legacy carry-forward flag", () => {
    expect(getCustomFieldRenewalBehavior({ carryForwardOnRenewal: true })).toBe("copy");
    expect(getCustomFieldRenewalBehavior({ carryForwardOnRenewal: false })).toBe("clear");
  });
});

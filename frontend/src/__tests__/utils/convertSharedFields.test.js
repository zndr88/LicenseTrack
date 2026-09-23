import { describe, expect, it } from "vitest";
import { pickFilledSharedFields, sharedFieldsCopyMessage } from "../../utils/convertSharedFields.js";

describe("pickFilledSharedFields", () => {
  it("includes secondary contacts and skips blank values", () => {
    expect(pickFilledSharedFields({
      contractNumber: "  ",
      supplier: "Reseller",
      costCentre: null,
      secondaryContacts: "a@example.com",
      notes: "not shared",
    })).toEqual({ supplier: "Reseller", secondaryContacts: "a@example.com" });
  });

  it("treats empty arrays as blank", () => {
    expect(pickFilledSharedFields({ secondaryContacts: [] })).toEqual({});
  });
});

describe("sharedFieldsCopyMessage", () => {
  it("reports the copied field and line counts", () => {
    expect(sharedFieldsCopyMessage(3, 2)).toBe("Copied 3 fields to 2 lines");
    expect(sharedFieldsCopyMessage(1, 1)).toBe("Copied 1 field to 1 line");
  });

  it("explains when nothing can be copied", () => {
    expect(sharedFieldsCopyMessage(0, 4)).toBe("Nothing to copy — the first line has no shared values");
  });
});

import { describe, expect, it } from "vitest";
import { buildConvertItemDefaults } from "../../utils/buildConvertItemDefaults.js";

// Every field a sourcing line carries must win over the renewed license's
// value. The line is what the user just reviewed; the predecessor is only a
// fallback. Add a field here whenever the defaults gain a line-level field.
const LINE_WINS = {
  publisherName: "Line Publisher",
  softwareDescription: "Line Description",
  purchaseDate: "2026-02-02",
  contractNumber: "LINE-CONTRACT",
  contactEmail: "line@example.test",
  costCentre: "Line Dept",
  licenseMetric: "per_device",
  portalUrl: "https://line.example.test",
  typeDescription: "Line type",
};

const PREDECESSOR = {
  id: 7,
  publisherName: "Old Publisher",
  softwareDescription: "Old Description",
  purchaseDate: "2025-01-01",
  contractNumber: "OLD-CONTRACT",
  contactEmail: "old@example.test",
  costCentre: "Old Dept",
  licenseMetric: "per_user",
  portalUrl: "https://old.example.test",
  typeDescription: "Old type",
  licenseType: "saas",
};

function convertWith(line) {
  const order = {
    poNumber: "PO-1",
    supplier: "S",
    items: [{ id: 1, isRenewal: true, renewalForLicenseId: 7, licenseType: "saas", ...line }],
  };
  return buildConvertItemDefaults(order, [PREDECESSOR])[0];
}

describe("buildConvertItemDefaults precedence", () => {
  it.each(Object.entries(LINE_WINS))("uses the line's %s over the renewed license", (field, value) => {
    expect(convertWith({ [field]: value })[field]).toBe(value);
  });

  it("falls back to the renewed license's portal URL when the line has none", () => {
    expect(convertWith({}).portalUrl).toBe("https://old.example.test");
  });
});

import { describe, expect, it } from "vitest";
import { buildMultiLicenseEmailHref, buildSingleLicenseEmailHref } from "../../utils/licenseEmailLinks.js";

function decode(href) {
  const [address, query] = href.replace(/^mailto:/, "").split("?");
  const params = new URLSearchParams(query);
  return { address, subject: params.get("subject"), body: params.get("body") };
}

const FULL = {
  publisherName: "Acme",
  softwareDescription: "Acme Suite",
  contractNumber: "CN-1",
  poNumber: "PO-1",
  invoiceNumber: "INV-1",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  licenseType: "subscription",
  contactEmail: "sales@acme.test",
};

describe("buildSingleLicenseEmailHref", () => {
  it("includes every populated reference", () => {
    const { address, subject, body } = decode(buildSingleLicenseEmailHref(FULL));

    expect(address).toBe("sales@acme.test");
    expect(subject).toBe("Re: Contract CN-1 - Acme Suite");
    expect(body).toContain("Contract: CN-1\nPO: PO-1\nInvoice: INV-1\nSoftware: Acme Suite\nPeriod: 2026-01-01 -> 2026-12-31");
  });

  it("omits blank reference lines instead of printing empty values", () => {
    const { body } = decode(buildSingleLicenseEmailHref({
      ...FULL, contractNumber: "", poNumber: null, invoiceNumber: undefined,
    }));

    expect(body).not.toMatch(/Contract:|PO:|Invoice:|null|undefined/);
    expect(body).toContain("Software: Acme Suite");
  });

  it("renders a non-expiring license as perpetual rather than null", () => {
    const { body } = decode(buildSingleLicenseEmailHref({ ...FULL, licenseType: "perpetual", endDate: null }));

    expect(body).toContain("Period: 2026-01-01 -> Perpetual");
    expect(body).not.toContain("null");
  });

  it("omits the end of the period when an expiring license has no end date", () => {
    const { body } = decode(buildSingleLicenseEmailHref({ ...FULL, endDate: "" }));

    expect(body).toContain("Period: from 2026-01-01");
  });

  it("falls back to the PO, then the description, for the subject", () => {
    expect(decode(buildSingleLicenseEmailHref({ ...FULL, contractNumber: "" })).subject).toBe("Re: PO PO-1 - Acme Suite");
    expect(decode(buildSingleLicenseEmailHref({ ...FULL, contractNumber: "", poNumber: "" })).subject).toBe("Re: Acme Suite");
  });
});

describe("buildMultiLicenseEmailHref", () => {
  it("omits blank per-line values", () => {
    const { subject, body } = decode(buildMultiLicenseEmailHref(FULL, [
      FULL,
      { ...FULL, softwareDescription: "Acme Addon", contractNumber: "", invoiceNumber: "", endDate: null, licenseType: "oem", quantity: "", skuCode: "" },
    ]));

    expect(subject).toBe("Re: PO PO-1 - Acme licenses");
    const secondLine = body.split("2. ")[1];
    expect(secondLine).not.toMatch(/Contract:|Invoice:|Quantity:|SKU:|null|- ->/);
    expect(secondLine).toContain("Period: 2026-01-01 -> Perpetual");
  });
});

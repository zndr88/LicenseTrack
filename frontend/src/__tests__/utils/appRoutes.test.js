import { describe, expect, it } from "vitest";
import {
  detailSectionFromHash,
  hashForDetailSection,
  parseAppPath,
  pathForState,
  pathMatchesLicense,
  resolveLicenseKey,
} from "../../utils/appRoutes.js";

describe("License Details section hashes", () => {
  it("maps visible section names to section keys and back", () => {
    expect(detailSectionFromHash("#documents")).toBe("documents");
    expect(detailSectionFromHash("#Key-Dates")).toBe("dates");
    expect(detailSectionFromHash("#custom-fields")).toBe("customFields");
    expect(detailSectionFromHash("#relationships")).toBe("people");
    expect(hashForDetailSection("documents")).toBe("#documents");
    expect(hashForDetailSection("commercial")).toBe("#details");
  });

  it("ignores unknown hashes and sections without one", () => {
    expect(detailSectionFromHash("")).toBeNull();
    expect(detailSectionFromHash("#identity")).toBeNull();
    expect(detailSectionFromHash("#toString")).toBeNull();
    expect(detailSectionFromHash("#%E0%A4%A")).toBeNull();
    expect(hashForDetailSection("identity")).toBe("");
  });

  it("matches a license path by record id or LT Ref", () => {
    const license = { id: 20, licenseRef: "LT-2026-00020", licenseRefAliases: ["OLD-9"] };
    expect(pathMatchesLicense("/licenses/20", license)).toBe(true);
    expect(pathMatchesLicense("/licenses/lt-2026-00020", license)).toBe(true);
    expect(pathMatchesLicense("/licenses/OLD-9", license)).toBe(true);
    expect(pathMatchesLicense("/licenses/21", license)).toBe(false);
    expect(pathMatchesLicense("/licenses", license)).toBe(false);
    expect(pathMatchesLicense("/renewals", license)).toBe(false);
  });
});

describe("appRoutes", () => {
  it("maps pages to paths and back", () => {
    const pages = ["licenses", "renewal-workbench", "sourcing", "pending-orders", "reports", "admin", "contracts", "help", "import"];
    for (const page of pages) {
      expect(parseAppPath(pathForState({ page }))).toEqual({ page, licenseKey: null, known: true });
    }
    expect(pathForState({ page: "renewal-workbench" })).toBe("/renewals");
  });

  it("carries the selected license only on the Licenses page", () => {
    expect(pathForState({ page: "licenses", licenseKey: 42 })).toBe("/licenses/42");
    expect(pathForState({ page: "reports", licenseKey: 42 })).toBe("/reports");
    expect(parseAppPath("/licenses/LT-2026-00001")).toEqual({ page: "licenses", licenseKey: "LT-2026-00001", known: true });
  });

  it("falls back to Licenses for unknown paths", () => {
    expect(parseAppPath("/")).toEqual({ page: "licenses", licenseKey: null, known: true });
    expect(parseAppPath("/nope")).toEqual({ page: "licenses", licenseKey: null, known: false });
    expect(parseAppPath("/reports/12")).toEqual({ page: "licenses", licenseKey: null, known: false });
  });

  it("resolves record ids and LT refs, preferring the current term of a chain", () => {
    const licenses = [
      { id: 1, licenseRef: "LT-1", startDate: "2025-01-01", lifecycleStatus: "renewed", renewedToId: 2 },
      { id: 2, licenseRef: "LT-1", startDate: "2026-01-01", lifecycleStatus: null },
      { id: 3, licenseRef: "LT-3", licenseRefAliases: ["OLD-3"], startDate: "2026-01-01" },
    ];

    expect(resolveLicenseKey("1", licenses)).toBe(1);
    expect(resolveLicenseKey("99", licenses)).toBeNull();
    expect(resolveLicenseKey("lt-1", licenses)).toBe(2);
    expect(resolveLicenseKey("OLD-3", licenses)).toBe(3);
    expect(resolveLicenseKey("LT-404", licenses)).toBeNull();
  });
});

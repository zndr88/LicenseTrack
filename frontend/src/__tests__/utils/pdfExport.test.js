import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportStructuredReportPdf } from "../../utils/pdfExport.js";

const captured = vi.hoisted(() => ({ text: [], savedAs: null, pages: 0 }));

// Real jsPDF does the layout; only the text written and the final save are observed.
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal();
  function jsPDF(options) {
    const pdf = new actual.jsPDF(options);
    const writeText = pdf.text.bind(pdf);
    pdf.text = (value, ...rest) => {
      captured.text.push(...(Array.isArray(value) ? value : [value]).map(String));
      return writeText(value, ...rest);
    };
    pdf.save = (filename) => {
      captured.savedAs = filename;
      captured.pages = pdf.getNumberOfPages();
      return pdf;
    };
    return pdf;
  }
  return { ...actual, jsPDF };
});

beforeEach(() => {
  captured.text = [];
  captured.savedAs = null;
  captured.pages = 0;
});

describe("exportStructuredReportPdf", () => {
  it("writes the report tables from server data and saves the file", async () => {
    await exportStructuredReportPdf({
      generatedAt: "2026-11-21T08:00:00Z",
      filters: { includeRetired: false, dateRange: "all", costCentres: ["IT"], forecastYears: 3, annualUpliftPct: "5" },
      counts: { records: 2, excluded: 0, unpriced: 1, undated: 0 },
      financialSummaries: { licenseSpendByCurrency: { EUR: "1200.00" } },
      budgetForecast: {
        singleCurrency: "EUR",
        recurringRecords: [{ publisher: "Acme", licenseType: "Subscription", currency: "EUR", annualCost: "1200.00" }],
        forecastRows: [{ year: 2027, baseline: "1200.00", growthAmount: "60.00", projectedBudget: "1260.00" }],
      },
      publisherData: [{ publisher: "Acme", totalSpendByCurrency: { EUR: "1200.00" }, licenseCount: 2 }],
      purchaseOrderData: { rows: [{ poNumber: "PO-1", identityType: "po", currency: "EUR", poValue: "1200.00", lineValue: "1200.00", difference: "0.00" }] },
    }, "license-lifecycle-full-report", { timeZone: "UTC" });

    expect(captured.savedAs).toBe("license-lifecycle-full-report.pdf");
    expect(captured.pages).toBeGreaterThanOrEqual(1);
    expect(captured.text).toContain("LicenseTrack Report");
    expect(captured.text).toContain("Generated: 2026-11-21");
    expect(captured.text).toContain("Records: 2");
    expect(captured.text).toContain("Budget forecast");
    expect(captured.text).toContain("Purchase order reconciliation");
    expect(captured.text).toContain("Acme");
    expect(captured.text).toContain("PO-1");
  });

  it("produces a report with placeholder rows when the data is empty", async () => {
    await exportStructuredReportPdf({}, "empty-report", undefined);

    expect(captured.savedAs).toBe("empty-report.pdf");
    expect(captured.text).toContain("No data");
  });
});

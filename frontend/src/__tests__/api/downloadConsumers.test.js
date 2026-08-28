import { beforeEach, describe, expect, test, vi } from "vitest";

import { downloadContractDocument } from "../../api/contracts.js";
import { downloadCsvTemplate } from "../../api/csvImport.js";
import { downloadApiFile } from "../../api/download.js";
import {
  downloadPendingOrderDocument,
  exportPendingOrdersCsv,
} from "../../api/pendingOrders.js";
import { exportDetailedReport } from "../../api/reports.js";
import {
  downloadSourcingQuoteDocument,
  exportSourcingCsv,
} from "../../api/sourcing.js";

vi.mock("../../api/download.js", () => ({
  downloadApiFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  downloadApiFile.mockResolvedValue({ data: null, error: null });
});

describe("API download consumers", () => {
  test("delegate domain paths, filenames, and fallback errors to the shared primitive", async () => {
    await downloadContractDocument(4, 9, "contract.pdf");
    await downloadCsvTemplate();
    await downloadPendingOrderDocument(12, "po.pdf");
    await exportPendingOrdersCsv();
    await exportDetailedReport({ dateRange: "all" });
    await downloadSourcingQuoteDocument(15, "quote.pdf");
    await exportSourcingCsv();

    expect(downloadApiFile).toHaveBeenNthCalledWith(
      1,
      "/api/contracts/4/documents/9/download",
      { filename: "contract.pdf" }
    );
    expect(downloadApiFile).toHaveBeenNthCalledWith(2, "/api/import/template", {
      filename: "license_lifecycle_template.csv",
      fallbackError: "Template download failed",
    });
    expect(downloadApiFile).toHaveBeenNthCalledWith(
      3,
      "/api/pending-orders/documents/12/download",
      { filename: "po.pdf" }
    );
    expect(downloadApiFile).toHaveBeenNthCalledWith(4, "/api/pending-orders/export", {
      filename: "pending_orders_export.csv",
      fallbackError: "Export failed",
    });
    expect(downloadApiFile).toHaveBeenNthCalledWith(
      5,
      expect.stringMatching(/^\/api\/reports\/detailed\/export\?/),
      {
        filename: "licensetrack_report.csv",
        fallbackError: "Report CSV export failed",
      }
    );
    expect(downloadApiFile).toHaveBeenNthCalledWith(
      6,
      "/api/sourcing/quote-documents/15/download",
      { filename: "quote.pdf" }
    );
    expect(downloadApiFile).toHaveBeenNthCalledWith(7, "/api/sourcing/export", {
      filename: "sourcing_export.csv",
      fallbackError: "Export failed",
    });
  });
});

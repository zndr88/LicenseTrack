import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_COLUMNS } from "../components/pages/renewals/workbenchColumns.js";
import {
  nextWorkbenchSort,
  prioritySortRows,
  sortWorkbenchRows,
} from "../components/pages/renewals/workbenchRules.js";
import { buildWorkbenchCsv } from "../components/pages/renewals/exportWorkbenchCsv.js";
import { escapeCsvCell } from "../utils/csvDownload.js";

const row = (overrides) => ({
  licenseId: 1,
  licenseRef: "LT-1",
  publisherName: "Acme",
  softwareDescription: "Suite",
  renewalStatus: "due_soon",
  daysUntilExpiry: 30,
  endDate: "2026-12-21",
  estimatedAnnualValue: 100,
  supplier: "Reseller",
  budgetOwnerEmail: "owner@example.com",
  documentCount: 1,
  riskFlags: [],
  currency: "EUR",
  customFields: [],
  ...overrides,
});

const WORKBENCH_ROWS = [
  row({ licenseId: 1, licenseRef: "LT-1", publisherName: "Zeta", supplier: "Bravo", daysUntilExpiry: 10, endDate: "2026-12-01", estimatedAnnualValue: 500, currency: "USD" }),
  row({ licenseId: 2, licenseRef: "LT-2", publisherName: "Acme", supplier: "", daysUntilExpiry: 20, endDate: "2026-12-11", estimatedAnnualValue: 1234.5, currency: "EUR" }),
  row({ licenseId: 3, licenseRef: "LT-3", publisherName: "Mid", supplier: "Alpha", daysUntilExpiry: 30, endDate: "2026-12-21", estimatedAnnualValue: 900, currency: "USD" }),
  row({ licenseId: 4, licenseRef: "LT-4", publisherName: "Beta", supplier: "Charlie", daysUntilExpiry: 40, endDate: "2026-12-31", estimatedAnnualValue: 50, currency: "EUR" }),
];

const ids = (rows) => rows.map((item) => item.licenseId);

describe("workbench sorting rules", () => {
  it("cycles a header through ascending, descending and back to the priority order", () => {
    const asc = nextWorkbenchSort(null, "supplier");
    expect(asc).toEqual({ column: "supplier", dir: "asc" });
    const desc = nextWorkbenchSort(asc, "supplier");
    expect(desc).toEqual({ column: "supplier", dir: "desc" });
    expect(nextWorkbenchSort(desc, "supplier")).toBeNull();
    expect(nextWorkbenchSort(desc, "value")).toEqual({ column: "value", dir: "asc" });
  });

  it("returns the priority order untouched when no column is chosen", () => {
    const ordered = prioritySortRows(WORKBENCH_ROWS);
    expect(sortWorkbenchRows(ordered, null)).toBe(ordered);
    expect(sortWorkbenchRows(ordered, { column: "status", dir: "asc" })).toBe(ordered);
  });

  it("sorts text columns both ways and keeps blanks last", () => {
    const ordered = prioritySortRows(WORKBENCH_ROWS);
    expect(ids(sortWorkbenchRows(ordered, { column: "license", dir: "asc" }))).toEqual([2, 4, 3, 1]);
    expect(ids(sortWorkbenchRows(ordered, { column: "supplier", dir: "asc" }))).toEqual([3, 1, 4, 2]);
    expect(ids(sortWorkbenchRows(ordered, { column: "supplier", dir: "desc" }))).toEqual([4, 1, 3, 2]);
  });

  it("sorts due date by the deadline the column shows, notice date included", () => {
    const rows = prioritySortRows([
      ...WORKBENCH_ROWS,
      row({ licenseId: 5, daysUntilExpiry: 200, daysUntilNotice: 15, noticeDate: "2026-12-06" }),
      row({ licenseId: 6, daysUntilExpiry: null, endDate: null }),
    ]);
    expect(ids(sortWorkbenchRows(rows, { column: "dueDate", dir: "asc" }))).toEqual([1, 5, 2, 3, 4, 6]);
    expect(ids(sortWorkbenchRows(rows, { column: "dueDate", dir: "desc" }))).toEqual([4, 3, 2, 5, 1, 6]);
  });

  it("sorts value inside each currency and never ranks one currency against another", () => {
    const ordered = prioritySortRows(WORKBENCH_ROWS);
    // EUR rows first (4: 50, 2: 1234.5), then USD (1: 500, 3: 900).
    expect(ids(sortWorkbenchRows(ordered, { column: "value", dir: "asc" }))).toEqual([4, 2, 1, 3]);
    expect(ids(sortWorkbenchRows(ordered, { column: "value", dir: "desc" }))).toEqual([2, 4, 3, 1]);
  });

  it("keeps the priority order between rows that tie", () => {
    const tied = prioritySortRows(WORKBENCH_ROWS.map((item) => ({ ...item, supplier: "Same" })));
    expect(ids(sortWorkbenchRows(tied, { column: "supplier", dir: "desc" }))).toEqual(ids(tied));
  });
});

describe("workbench CSV export", () => {
  const lines = (csv) => csv.replace(/^\ufeff/, "").split("\r\n");

  it("writes the visible columns with ISO dates, plain decimals and a currency per row", () => {
    const columns = BUILT_IN_COLUMNS.filter((column) => column.id !== "riskFlags");
    const csv = buildWorkbenchCsv([
      row({
        licenseId: 2, licenseRef: "LT-2", publisherName: "Acme, Inc.", softwareDescription: "Suite",
        daysUntilExpiry: -5, endDate: "2026-11-16", estimatedAnnualValue: 1234.5, currency: "EUR", renewalStatus: "expired_unresolved",
      }),
      row({ licenseId: 1, licenseRef: "LT-1", daysUntilExpiry: 100, daysUntilNotice: 10, noticeDate: "2026-12-01", estimatedAnnualValue: 500, currency: "USD" }),
    ], columns);

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(lines(csv)).toEqual([
      "Due Date,Deadline Type,Days,Publisher,Software Description,License Ref,Supplier,Budget Owner,Estimated Annual Value,Currency,Status",
      '2026-11-16,End date,-5,"Acme, Inc.",Suite,LT-2,Reseller,owner@example.com,1234.50,EUR,Expired',
      "2026-12-01,Notice deadline,10,Acme,Suite,LT-1,Reseller,owner@example.com,500.00,USD,Due Soon",
    ]);
  });

  it("leaves out hidden columns and exports custom fields and risk flags as plain values", () => {
    const columns = [
      { id: "license", label: "Publisher / Software" },
      { id: "riskFlags", label: "Risk Flags" },
      { id: "cf_owner", label: "Service Owner", isCustom: true, fieldKey: "owner", fieldKeys: ["owner"] },
      { id: "cf_budget", label: "Budget", isCustom: true, fieldKey: "budget", fieldKeys: ["budget"] },
      { id: "actions", label: "Actions" },
    ];
    const csv = buildWorkbenchCsv([
      row({
        riskFlags: [
          { code: "no_documents", severity: "low", label: "No documents" },
          { code: "expired", severity: "high", label: "Expired" },
        ],
        customFields: [
          { fieldKey: "owner", fieldType: "text", valueText: "IT Ops" },
          { fieldKey: "budget", fieldType: "currency", valueCurrency: 2500 },
        ],
      }),
    ], columns);

    expect(lines(csv)).toEqual([
      "Publisher,Software Description,Risk Flags,Service Owner,Budget",
      "Acme,Suite,Expired; No documents,IT Ops,2500.00",
    ]);
  });

  it("neutralises text a spreadsheet would run as a formula", () => {
    const csv = buildWorkbenchCsv([row({ publisherName: "=HYPERLINK(1)", supplier: " +SUM(A1)", budgetOwnerEmail: "@cmd" })], [
      { id: "license" }, { id: "supplier" }, { id: "budgetOwner" },
    ]);
    expect(lines(csv)[1]).toBe("'=HYPERLINK(1),Suite,' +SUM(A1),'@cmd");
    expect(escapeCsvCell("-12.50")).toBe("'-12.50");
    expect(escapeCsvCell(-12.5)).toBe("-12.5");
  });
});

vi.mock("../api/renewals.js", () => ({ getRenewalWorkbench: vi.fn() }));
vi.mock("../api/settings.js", () => ({ updateSettings: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("../hooks/useCustomFieldDefinitions.js", () => ({
  fetchCustomFieldDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../hooks/useRenewalWorkflowActions.js", () => ({
  useRenewalWorkflowActions: () => ({ startRenewal: vi.fn(), startRenewalBundle: vi.fn(), startSupportRenewal: vi.fn() }),
}));
vi.mock("../utils/csvDownload.js", async (importOriginal) => ({
  ...(await importOriginal()),
  downloadCsv: vi.fn(),
}));

import RenewalWorkbenchPage from "../components/pages/RenewalWorkbenchPage.jsx";
import { getRenewalWorkbench } from "../api/renewals.js";
import { downloadCsv } from "../utils/csvDownload.js";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RenewalWorkbenchPage user={{ role: "viewer" }} userSettings={{ numberFormatLocale: "en-US" }} globalSettings={{}} />
    </QueryClientProvider>,
  );
}

const shownRefs = () => screen.getAllByRole("row").slice(1).map((tr) => within(tr).getByText(/^LT-\d+$/).textContent);

describe("Renewal Workbench page: sorting and export", () => {
  beforeEach(() => {
    getRenewalWorkbench.mockResolvedValue({ data: WORKBENCH_ROWS, error: null });
    downloadCsv.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("sorts from the header with mouse and keyboard and reports the order", async () => {
    renderPage();
    const supplier = await screen.findByRole("columnheader", { name: /supplier/i });
    expect(shownRefs()).toEqual(["LT-1", "LT-2", "LT-3", "LT-4"]);
    expect(supplier).toHaveAttribute("aria-sort", "none");
    expect(supplier).toHaveAttribute("tabindex", "0");

    fireEvent.click(supplier);
    expect(supplier).toHaveAttribute("aria-sort", "ascending");
    expect(shownRefs()).toEqual(["LT-3", "LT-1", "LT-4", "LT-2"]);

    fireEvent.keyDown(supplier, { key: "Enter" });
    expect(supplier).toHaveAttribute("aria-sort", "descending");
    expect(shownRefs()).toEqual(["LT-4", "LT-1", "LT-3", "LT-2"]);

    fireEvent.keyDown(supplier, { key: " " });
    expect(supplier).toHaveAttribute("aria-sort", "none");
    expect(shownRefs()).toEqual(["LT-1", "LT-2", "LT-3", "LT-4"]);

    for (const name of [/due date/i, /publisher/i, /budget owner/i, /value/i]) {
      expect(screen.getByRole("columnheader", { name })).toHaveAttribute("aria-sort", "none");
    }
    expect(screen.getByRole("columnheader", { name: /status/i })).not.toHaveAttribute("aria-sort");
  });

  it("exports the rows on screen in the order on screen", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("columnheader", { name: /publisher/i }));
    fireEvent.change(screen.getByLabelText(/search renewal workbench/i), { target: { value: "LT-" } });
    fireEvent.change(screen.getByLabelText(/search renewal workbench/i), { target: { value: "a" } });
    const expected = shownRefs();
    expect(expected.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, content] = downloadCsv.mock.calls[0];
    expect(filename).toBe("renewal_workbench_export.csv");
    const exportedRefs = content.split("\r\n").slice(1).map((line) => line.match(/LT-\d+/)[0]);
    expect(exportedRefs).toEqual(expected);
    expect(content.split("\r\n")[0]).not.toMatch(/Actions/);
  });

  it("disables the export when no row matches", async () => {
    renderPage();
    await screen.findByRole("columnheader", { name: /supplier/i });
    fireEvent.change(screen.getByLabelText(/search renewal workbench/i), { target: { value: "no such row" } });
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });
});

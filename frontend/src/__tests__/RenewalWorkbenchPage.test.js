import {
  buildWorkbenchColumns,
  getVisibleWorkbenchColumns,
  renderCustomFieldDisplay,
} from "../components/pages/renewals/workbenchColumns.js";
import {
  getPrimaryAction,
  getRiskFlagDisplay,
  getViewCounts,
  includesSearch,
  prioritySortRows,
} from "../components/pages/renewals/workbenchRules.js";

const row = (overrides) => ({
  licenseId: 1,
  publisherName: "Acme",
  softwareDescription: "Suite",
  renewalStatus: "due_soon",
  daysUntilExpiry: 30,
  estimatedAnnualValue: 0,
  budgetOwnerEmail: "owner@example.com",
  documentCount: 1,
  riskFlags: [],
  currency: "EUR",
  customFields: [],
  ...overrides,
});

describe("RenewalWorkbenchPage helpers", () => {
  test("derives prebuilt view counts from all rows", () => {
    const rows = [
      row({ licenseId: 1, renewalStatus: "expired_unresolved", daysUntilExpiry: -2, documentCount: 0 }),
      row({ licenseId: 2, daysUntilExpiry: 20 }),
      row({ licenseId: 3, daysUntilExpiry: 120, estimatedAnnualValue: 70000 }),
      row({ licenseId: 4, renewalStatus: "pending_order", pendingOrderId: 10, daysUntilExpiry: 150 }),
    ];

    expect(getViewCounts(rows)).toMatchObject({
      all: 4,
      needs_action: 3,
      overdue: 1,
      due_30: 1,
      due_60: 1,
      due_90: 1,
      in_progress: 1,
      missing_docs: 1,
      high_value: 1,
    });
  });

  test("sorts by cockpit urgency before later renewals", () => {
    const sorted = prioritySortRows([
      row({ licenseId: 4, daysUntilExpiry: 120, publisherName: "Delta" }),
      row({ licenseId: 2, renewalStatus: "pending_order", daysUntilExpiry: 5, publisherName: "Beta" }),
      row({ licenseId: 3, daysUntilExpiry: 5, publisherName: "Gamma", riskFlags: [{ code: "high_value", label: "High value", severity: "high" }] }),
      row({ licenseId: 1, renewalStatus: "expired_unresolved", daysUntilExpiry: -1, publisherName: "Alpha" }),
    ]);

    expect(sorted.map((item) => item.licenseId)).toEqual([1, 3, 4, 2]);
  });

  test("orders and truncates risk flags by severity and priority", () => {
    const display = getRiskFlagDisplay([
      { code: "no_po", label: "No PO", severity: "low" },
      { code: "high_value", label: "High value", severity: "high" },
      { code: "expired", label: "Expired", severity: "high" },
      { code: "no_supplier", label: "No supplier", severity: "medium" },
    ]);

    expect(display.visible.map((flag) => flag.code)).toEqual(["expired", "high_value", "no_supplier"]);
    expect(display.hidden.map((flag) => flag.code)).toEqual(["no_po"]);
  });

  test("discovers custom field columns from row data", () => {
    const columns = buildWorkbenchColumns([
      row({
        customFields: [
          { fieldKey: "contract_owner", name: "Contract Owner", fieldType: "text", valueText: "Alice" },
        ],
      }),
    ]);

    expect(columns.some((column) => column.id === "cf_contract_owner")).toBe(true);
    const customColumn = columns.find((column) => column.id === "cf_contract_owner");
    expect(customColumn).toMatchObject({
      label: "Contract Owner",
      fieldType: "text",
      defaultVisible: false,
      legacyIds: ["custom:contract_owner"],
    });
  });

  test("includes custom field columns from definitions even when rows have no values", () => {
    const columns = buildWorkbenchColumns(
      [row({ customFields: [] })],
      [{ fieldKey: "renewal_owner", name: "Renewal Owner", fieldType: "text", section: "people" }],
    );

    const customColumn = columns.find((column) => column.id === "cf_renewal_owner");
    expect(customColumn).toMatchObject({
      label: "Renewal Owner",
      fieldType: "text",
      section: "people",
      defaultVisible: false,
      isCustom: true,
    });
  });

  test("does not double-prefix custom field column ids", () => {
    const columns = buildWorkbenchColumns([
      row({
        customFields: [
          { fieldKey: "cf_contract_owner", name: "Contract Owner", fieldType: "text", valueText: "Alice" },
        ],
      }),
    ]);

    expect(columns.some((column) => column.id === "cf_contract_owner")).toBe(true);
    expect(columns.some((column) => column.id === "cf_cf_contract_owner")).toBe(false);
  });

  test("respects custom field column visibility settings", () => {
    const columns = buildWorkbenchColumns([
      row({
        customFields: [
          { fieldKey: "contract_owner", name: "Contract Owner", fieldType: "text", valueText: "Alice" },
        ],
      }),
    ]);

    expect(getVisibleWorkbenchColumns(columns, {}).map((column) => column.id)).not.toContain("cf_contract_owner");
    expect(getVisibleWorkbenchColumns(columns, { cf_contract_owner: true }).map((column) => column.id)).toContain("cf_contract_owner");
  });

  test("preserves legacy custom field column visibility settings", () => {
    const columns = buildWorkbenchColumns([
      row({
        customFields: [
          { fieldKey: "contract_owner", name: "Contract Owner", fieldType: "text", valueText: "Alice" },
        ],
      }),
    ]);

    expect(getVisibleWorkbenchColumns(columns, { "custom:contract_owner": true }).map((column) => column.id)).toContain("cf_contract_owner");
    expect(getVisibleWorkbenchColumns(columns, { "custom:contract_owner": false }).map((column) => column.id)).not.toContain("cf_contract_owner");
  });

  test("renders imported date custom field values using user date format", () => {
    const invoiceField = { fieldKey: "cf_invoice_date", name: "Invoice date", fieldType: "date", valueText: "2026-02-14" };

    // DD/MM/YYYY (default when no userSettings)
    expect(renderCustomFieldDisplay(invoiceField, row(), "en-US", null)).toBe("14/02/2026");
    // MM/DD/YYYY
    expect(renderCustomFieldDisplay(invoiceField, row(), "en-US", { dateFormat: "MM/DD/YYYY" })).toBe("02/14/2026");
    // YYYY-MM-DD (ISO)
    expect(renderCustomFieldDisplay(invoiceField, row(), "en-US", { dateFormat: "YYYY-MM-DD" })).toBe("2026-02-14");
  });

  test("renders boolean custom field values as True, False, or blank", () => {
    expect(renderCustomFieldDisplay({ fieldType: "boolean", valueText: "true" }, row(), "en-US")).toBe("True");
    expect(renderCustomFieldDisplay({ fieldType: "boolean", valueText: "false" }, row(), "en-US")).toBe("False");
    expect(renderCustomFieldDisplay({ fieldType: "boolean", valueText: null }, row(), "en-US")).toBe("-");
  });

  test("search matches hidden custom field values", () => {
    const item = row({
      customFields: [
        { fieldKey: "cf_invoice_date", name: "Invoice date", fieldType: "date", valueText: "2026-02-14" },
      ],
    });

    expect(includesSearch(item, "2026-02-14")).toBe(true);
    expect(includesSearch(item, "invoice date")).toBe(true);
  });

  test("chooses primary row action by permission and row state", () => {
    expect(getPrimaryAction(row({ pendingOrderId: 5 }), { canOpenPipeline: true, canStartRenewal: true })).toBe("po");
    expect(getPrimaryAction(row({ sourcingItemId: 8 }), { canOpenPipeline: true, canStartRenewal: true })).toBe("sourcing");
    expect(getPrimaryAction(row(), { canOpenPipeline: true, canStartRenewal: true })).toBe("start");
    expect(getPrimaryAction(row({ budgetOwnerEmail: " " }), { canOpenPipeline: true, canStartRenewal: true })).toBeNull();
    expect(getPrimaryAction(row(), { canOpenPipeline: false, canStartRenewal: false })).toBeNull();
  });

  test("handles larger row sets deterministically", () => {
    const rows = Array.from({ length: 1500 }, (_, index) => row({
      licenseId: index + 1,
      publisherName: `Publisher ${1500 - index}`,
      daysUntilExpiry: index % 240,
      estimatedAnnualValue: index,
    }));

    expect(prioritySortRows(rows)).toHaveLength(1500);
    expect(getViewCounts(rows).all).toBe(1500);
    expect(includesSearch(rows[1499], "Publisher 1")).toBe(true);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PreviewStep from "../../components/csv-import/PreviewStep.jsx";

const basePreviewData = {
  totalRows: 2,
  activeCount: 2,
  legacyExemptCount: 0,
  legacyIncompleteCount: 0,
  errorCount: 0,
  duplicateWarningCount: 0,
  headersMissing: [],
  rows: [],
  warningSummary: {
    hasWarnings: false,
    defaultedCurrencyCount: 0,
    defaultedEnumCount: 0,
    ambiguousDateCount: 0,
    inferredParentCount: 0,
    duplicateWarningCount: 0,
    rowsWithWarningsCount: 0,
  },
};

const defaultProps = {
  previewData: basePreviewData,
  skippedRows: new Set(),
  selectedRows: new Set(),
  duplicateWarningCount: 0,
  importableRowsCount: 2,
  allSelectableSelected: false,
  selectableRows: [],
  selectedImportableRows: [],
  selectedRowsToSkip: [],
  selectedRowsToRestore: [],
  toggleSelectedRow: vi.fn(),
  toggleAllSelectableRows: vi.fn(),
  skipRows: vi.fn(),
  restoreRows: vi.fn(),
  handleConfirm: vi.fn(),
  reset: vi.fn(),
};

describe("PreviewStep — warning summary", () => {
  it("does not show warning summary for a clean import", () => {
    render(<PreviewStep {...defaultProps} />);
    expect(document.querySelector("[data-testid='csv-warning-summary']")).toBeNull();
  });

  it("shows warning summary section when hasWarnings is true", () => {
    const props = {
      ...defaultProps,
      previewData: {
        ...basePreviewData,
        warningSummary: {
          hasWarnings: true,
          defaultedCurrencyCount: 0,
          defaultedEnumCount: 1,
          ambiguousDateCount: 0,
          inferredParentCount: 0,
          duplicateWarningCount: 0,
          rowsWithWarningsCount: 1,
        },
      },
    };
    render(<PreviewStep {...props} />);
    expect(document.querySelector("[data-testid='csv-warning-summary']")).not.toBeNull();
  });

  it("shows an explicit warning acknowledgement button when hasWarnings is true", () => {
    const props = {
      ...defaultProps,
      previewData: {
        ...basePreviewData,
        warningSummary: {
          hasWarnings: true,
          defaultedCurrencyCount: 0,
          defaultedEnumCount: 1,
          ambiguousDateCount: 0,
          inferredParentCount: 0,
          duplicateWarningCount: 0,
          rowsWithWarningsCount: 1,
        },
      },
    };
    render(<PreviewStep {...props} />);
    const button = screen.getByRole("button", { name: /acknowledge warnings and import/i });
    expect(button).toBeTruthy();
  });

  it("closes the importer columns dialog with Escape and returns focus", () => {
    render(<PreviewStep {...defaultProps} />);

    const button = screen.getByRole("button", { name: "Choose importer columns" });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Importer columns" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Importer columns" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("shows standard 'Import N licenses' button label when no warnings", () => {
    render(<PreviewStep {...defaultProps} />);
    const button = screen.getByRole("button", { name: /import 2 licenses/i });
    expect(button).toBeTruthy();
  });

  it("lets a maintenance parent error choose an existing parent license", () => {
    const setMaintenanceParentOverride = vi.fn();
    const props = {
      ...defaultProps,
      previewData: {
        ...basePreviewData,
        totalRows: 1,
        activeCount: 0,
        errorCount: 1,
        validRows: 0,
        rows: [{
          rowNumber: 4,
          publisherName: "Acme",
          softwareDescription: "Acme Support",
          licenseType: "maintenance",
          quantity: "1",
          unitPrice: "",
          totalPoPrice: "",
          startDate: "",
          endDate: "",
          noticeDate: "",
          requestDate: "",
          purchaseDate: "",
          contractNumber: "",
          poNumber: "",
          supplier: "",
          costCentre: "",
          importStatus: "error",
          importAction: "create",
          validationErrors: ["Maintenance rows require a 'parent_license_ref' column or a matching perpetual/oem/freeware parent row in the same import."],
          warnings: [],
          duplicateWarnings: [],
        }],
      },
      importableRowsCount: 0,
      eligibleMaintenanceParents: [{
        id: 42,
        licenseRef: "LT-2026-00042",
        publisherName: "Acme",
        softwareDescription: "Widget",
        poNumber: "PO-42",
      }],
      setMaintenanceParentOverride,
    };

    render(<PreviewStep {...props} />);

    const parentSearch = screen.getByLabelText("Maintenance parent required");
    fireEvent.focus(parentSearch);
    fireEvent.change(parentSearch, { target: { value: "42" } });
    fireEvent.click(screen.getByRole("option", { name: /LT-2026-00042/i }));

    expect(setMaintenanceParentOverride).toHaveBeenCalledWith(4, "42");
  });

  it("lets users hide importer columns without hiding workflow columns", () => {
    const props = {
      ...defaultProps,
      previewData: {
        ...basePreviewData,
        rows: [{
          rowNumber: 1,
          publisherName: "Acme",
          softwareDescription: "Widget",
          licenseType: "perpetual",
          importStatus: "active",
          validationErrors: [],
          warnings: [],
          duplicateWarnings: [],
        }],
      },
      selectableRows: [{ rowNumber: 1 }],
    };

    render(<PreviewStep {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose importer columns" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Publisher column" }));

    expect(screen.queryByRole("columnheader", { name: "Publisher" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Import" })).toBeTruthy();
    expect(screen.getByRole("table")).toHaveClass("csv-preview-table-condensed");
  });
});

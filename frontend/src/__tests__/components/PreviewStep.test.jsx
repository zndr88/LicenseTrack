import { render, screen } from "@testing-library/react";
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

  it("shows 'Import with warnings' button label when hasWarnings is true", () => {
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
    const button = screen.getByRole("button", { name: /import with warnings/i });
    expect(button).toBeTruthy();
  });

  it("shows standard 'Import N licenses' button label when no warnings", () => {
    render(<PreviewStep {...defaultProps} />);
    const button = screen.getByRole("button", { name: /import 2 licenses/i });
    expect(button).toBeTruthy();
  });
});

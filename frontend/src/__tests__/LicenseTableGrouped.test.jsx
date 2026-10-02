import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LicenseTable from "../components/pages/licenses/LicenseTable.jsx";
import { COLUMN_DEFS, mergeVisibleColumns } from "../components/pages/licenses/licenseColumns.js";
import { flattenGroups, groupLicenses } from "../components/pages/licenses/registryGrouping.js";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 40, end: (index + 1) * 40 })),
    getTotalSize: () => count * 40,
  }),
}));

const lic = (id, poNumber, publisherName) => ({
  id, poNumber, publisherName, softwareDescription: `Item ${id}`, currency: "EUR", quantity: "1", unitPrice: "10",
  expiration: { status: "active", label: "Active" }, completeness: { isComplete: true, percentage: 100 },
});

function renderGrouped(expanded = new Set()) {
  const lines = [lic(1, "PO-1", "Okta"), lic(2, "PO-1", "Adobe"), lic(3, "PO-2", "Okta")];
  const nodes = groupLicenses(lines, ["poNumber"], { allLicenses: lines });
  const onToggleGroup = vi.fn();
  render(
    <LicenseTable
      filtered={lines} sorted={lines} paginatedItems={lines} licenses={lines}
      departments={[]} datesFromOptions={[]} datesToOptions={[]} customFieldValuesMap={new Map()}
      activeColumns={COLUMN_DEFS} visList={mergeVisibleColumns({})} displayCurrency="EUR"
      userSettings={{ numberFormatLocale: "en-US" }} setUserSettings={vi.fn()} handleHideColumn={vi.fn()}
      sortCol={null} sortDir="asc" handleSortCol={vi.fn()} selectedIds={new Set()} setSelectedIds={vi.fn()}
      filterRowOpen={false} columnFilters={{}} setColumnFilters={vi.fn()} hasColumnFilters={false}
      currentPage={1} setCurrentPage={vi.fn()} pageSize={20} setPageSize={vi.fn()} totalPages={1}
      hoveredCol={null} setHoveredCol={vi.fn()} selectedId={null} setSelectedId={vi.fn()}
      inlineEditEnabled={false} onInlineFieldSave={vi.fn()} layoutVersion={0}
      groupRows={flattenGroups(nodes, expanded)} groupCount={nodes.length}
      expandedGroupIds={expanded} onToggleGroup={onToggleGroup}
    />,
  );
  return { onToggleGroup };
}

describe("LicenseTable grouped", () => {
  it("shows collapsed group headers and a grouped footer instead of pages", () => {
    renderGrouped();
    expect(screen.getAllByRole("button", { name: /PO # · / })).toHaveLength(2);
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
    expect(screen.getByText(/2 groups · 3 lines/)).toBeInTheDocument();
    expect(screen.queryByText(/Per page/)).not.toBeInTheDocument();
  });

  it("shows the lines of an open group", () => {
    renderGrouped(new Set(["poNumber:po-1"]));
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.queryByText("Item 3")).not.toBeInTheDocument();
  });

  it("toggles through onToggleGroup", () => {
    const { onToggleGroup } = renderGrouped();
    fireEvent.click(screen.getByRole("button", { name: /PO # · PO-2/ }));
    expect(onToggleGroup).toHaveBeenCalledWith("poNumber:po-2");
  });
});

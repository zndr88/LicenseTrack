import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseTableHeader from "../components/pages/licenses/LicenseTableHeader.jsx";

describe("LicenseTableHeader sortable capability", () => {
  test("does not advertise or invoke sorting for an unsupported column", () => {
    const handleSortCol = vi.fn();
    render(
      <table>
        <LicenseTableHeader
          visibleColumns={[{ key: "unknown", label: "Unknown", width: 100 }]}
          selectAllRef={{ current: null }}
          allDisplayedSelected={false}
          displayRows={[]}
          selectionLabel="Select all licenses on this page"
          setSelectedIds={vi.fn()}
          dragHappenedRef={{ current: false }}
          setUserSettings={vi.fn()}
          setHoveredCol={vi.fn()}
          hoveredCol={null}
          handleSortCol={handleSortCol}
          sortCol={null}
          sortDir="asc"
          handleHideColumn={vi.fn()}
          filterRowOpen={false}
          columnFilters={{}}
          setColumnFilters={vi.fn()}
          departments={[]}
          datesFromOptions={[]}
          datesToOptions={[]}
        />
      </table>,
    );

    const header = screen.getByRole("columnheader", { name: "Unknown" });
    expect(header).not.toHaveAttribute("tabindex", "0");
    expect(header).toHaveAttribute("title", "Drag to reorder");
    expect(header).toHaveStyle({ cursor: "default" });
    fireEvent.click(header);
    fireEvent.keyDown(header, { key: "Enter" });
    expect(handleSortCol).not.toHaveBeenCalled();
  });

  test("select-all only adds the displayed page rows", () => {
    const setSelectedIds = vi.fn();
    render(
      <table>
        <LicenseTableHeader
          visibleColumns={[{ key: "select", label: "Select", width: 40 }]}
          selectAllRef={{ current: null }}
          allDisplayedSelected={false}
          displayRows={[{ id: 2 }, { id: 3 }]}
          selectionLabel="Select all licenses on this page"
          setSelectedIds={setSelectedIds}
          dragHappenedRef={{ current: false }}
          setUserSettings={vi.fn()}
          setHoveredCol={vi.fn()}
          hoveredCol={null}
          handleSortCol={vi.fn()}
          sortCol={null}
          sortDir="asc"
          handleHideColumn={vi.fn()}
          filterRowOpen={false}
          columnFilters={{}}
          setColumnFilters={vi.fn()}
          departments={[]}
          datesFromOptions={[]}
          datesToOptions={[]}
        />
      </table>,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all licenses on this page" }));
    const update = setSelectedIds.mock.calls[0][0];
    expect([...update(new Set([99]))]).toEqual([99, 2, 3]);
  });

  test("a drag that ends elsewhere does not block the next sort click", () => {
    const handleSortCol = vi.fn();
    const dragHappenedRef = { current: false };
    render(
      <table>
        <LicenseTableHeader
          visibleColumns={[{ key: "publisher", label: "Publisher", width: 100 }]}
          selectAllRef={{ current: null }}
          allDisplayedSelected={false}
          displayRows={[]}
          selectionLabel="Select all licenses on this page"
          setSelectedIds={vi.fn()}
          dragHappenedRef={dragHappenedRef}
          setUserSettings={vi.fn()}
          setHoveredCol={vi.fn()}
          hoveredCol={null}
          handleSortCol={handleSortCol}
          sortCol={null}
          sortDir="asc"
          handleHideColumn={vi.fn()}
          filterRowOpen={false}
          columnFilters={{}}
          setColumnFilters={vi.fn()}
          departments={[]}
          datesFromOptions={[]}
          datesToOptions={[]}
        />
      </table>,
    );
    const header = screen.getByRole("columnheader", { name: /Publisher/ });
    fireEvent.dragStart(header, { dataTransfer: { setData: () => {} } });
    fireEvent.dragEnd(header);
    fireEvent.click(header);
    expect(handleSortCol).toHaveBeenCalledWith("publisher");
  });
});

describe("LicenseTableHeader groupable columns", () => {
  function renderWith(showGroupableColumns) {
    render(
      <table>
        <LicenseTableHeader
          visibleColumns={[{ key: "poNumber", label: "PO #", width: 100 }, { key: "unitPrice", label: "Unit Price", width: 100 }]}
          selectAllRef={{ current: null }}
          allDisplayedSelected={false}
          displayRows={[]}
          selectionLabel="Select all"
          setSelectedIds={vi.fn()}
          dragHappenedRef={{ current: false }}
          setUserSettings={vi.fn()}
          setHoveredCol={vi.fn()}
          hoveredCol={null}
          handleSortCol={vi.fn()}
          sortCol={null}
          sortDir="asc"
          handleHideColumn={vi.fn()}
          filterRowOpen={false}
          columnFilters={{}}
          setColumnFilters={vi.fn()}
          departments={[]}
          datesFromOptions={[]}
          datesToOptions={[]}
          showGroupableColumns={showGroupableColumns}
        />
      </table>,
    );
  }

  test("marks groupable headers while the grouping strip is shown", () => {
    renderWith(true);
    expect(screen.getByRole("columnheader", { name: /PO #/ })).toHaveClass("lp-th-groupable");
    expect(screen.getByRole("columnheader", { name: /Unit Price/ })).not.toHaveClass("lp-th-groupable");
  });

  test("marks nothing when the strip is hidden", () => {
    renderWith(false);
    expect(screen.getByRole("columnheader", { name: /PO #/ })).not.toHaveClass("lp-th-groupable");
  });
});

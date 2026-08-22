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
          allFilteredSelected={false}
          filtered={[]}
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
});

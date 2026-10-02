import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LicenseGroupStrip, { groupingKeyForColumn } from "../components/pages/licenses/LicenseGroupStrip.jsx";

function drop(target, colKey) {
  fireEvent.drop(target, { dataTransfer: { getData: (type) => (type === "colKey" ? colKey : "") } });
}

function renderStrip(groupBy = []) {
  const props = { groupBy, onChange: vi.fn(), onExpandAll: vi.fn(), onCollapseAll: vi.fn() };
  render(<LicenseGroupStrip {...props} />);
  return props;
}

describe("LicenseGroupStrip", () => {
  it("invites a drop when empty", () => {
    renderStrip();
    expect(screen.getByText("Drag a column header here to group by that column")).toBeInTheDocument();
  });

  it("adds a dropped groupable column", () => {
    const { onChange } = renderStrip();
    drop(screen.getByRole("region", { name: "Grouping" }), "poNumber");
    expect(onChange).toHaveBeenCalledWith(["poNumber"]);
  });

  it("adds a second level on a second drop", () => {
    const { onChange } = renderStrip(["poNumber"]);
    drop(screen.getByRole("region", { name: "Grouping" }), "publisher");
    expect(onChange).toHaveBeenCalledWith(["poNumber", "publisher"]);
  });

  it("ignores columns that cannot be grouped and refuses a third level", () => {
    const { onChange } = renderStrip(["poNumber", "publisher"]);
    drop(screen.getByRole("region", { name: "Grouping" }), "status");
    drop(screen.getByRole("region", { name: "Grouping" }), "notes");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Up to 2 grouping levels")).toBeInTheDocument();
  });

  it("removes and swaps chips", () => {
    const { onChange } = renderStrip(["poNumber", "publisher"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove grouping by PO #" }));
    expect(onChange).toHaveBeenLastCalledWith(["publisher"]);
    fireEvent.click(screen.getByRole("button", { name: "Swap grouping levels" }));
    expect(onChange).toHaveBeenLastCalledWith(["publisher", "poNumber"]);
  });

  it("the picker lists only unused columns", () => {
    const { onChange } = renderStrip(["poNumber"]);
    const picker = screen.getByLabelText("Add grouping");
    expect(picker.querySelector('option[value="poNumber"]')).toBeNull();
    fireEvent.change(picker, { target: { value: "status" } });
    expect(onChange).toHaveBeenCalledWith(["poNumber", "status"]);
  });

  it("maps table column keys to grouping keys", () => {
    expect(groupingKeyForColumn("endDate")).toBe("endYear");
    expect(groupingKeyForColumn("expiration")).toBe("status");
    expect(groupingKeyForColumn("notes")).toBeNull();
  });
});

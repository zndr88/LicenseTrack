import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SortableHeader from "../components/ui/SortableHeader.jsx";
import SourcingTable from "../components/pages/sourcing/SourcingTable.jsx";
import PendingOrdersTable from "../components/pages/pendingOrders/PendingOrdersTable.jsx";

function renderHeader(props) {
  return render(
    <table><thead><tr>
      <SortableHeader column="supplier" label="Supplier" onSort={vi.fn()} {...props} />
    </tr></thead></table>,
  );
}

describe("SortableHeader", () => {
  it("is reachable by keyboard and announces no order while another column sorts", () => {
    renderHeader({ sortCol: "created", sortDir: "asc" });
    const header = screen.getByRole("columnheader", { name: "Supplier" });
    expect(header).toHaveAttribute("tabindex", "0");
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(header).toHaveTextContent(/^Supplier$/);
  });

  it.each([["asc", "ascending"], ["desc", "descending"]])("announces %s as %s", (sortDir, announced) => {
    renderHeader({ sortCol: "supplier", sortDir });
    expect(screen.getByRole("columnheader", { name: /Supplier/ })).toHaveAttribute("aria-sort", announced);
  });

  it("sorts on click, Enter and Space, and ignores other keys", () => {
    const onSort = vi.fn();
    renderHeader({ onSort });
    const header = screen.getByRole("columnheader", { name: "Supplier" });

    fireEvent.click(header);
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    fireEvent.keyDown(header, { key: "Tab" });
    fireEvent.keyDown(header, { key: "a" });

    expect(onSort).toHaveBeenCalledTimes(3);
    expect(onSort).toHaveBeenCalledWith("supplier");
  });
});

const request = {
  id: 7,
  supplier: "Example Supplier",
  createdAt: "2026-09-19T14:35:00Z",
  status: "sourcing",
  items: [{ id: 1, publisherName: "Acme", softwareDescription: "Product A", quantity: "1", currency: "EUR" }],
};

const order = { ...request, poNumber: "PO-7", status: "pending" };

function expectKeyboardSortable(columns, onSort, { sorted, plain }) {
  for (const [label, column] of columns) {
    const header = screen.getByRole("columnheader", { name: new RegExp(`^${label}`) });
    expect(header).toHaveAttribute("tabindex", "0");
    expect(header).toHaveAttribute("aria-sort", column === sorted ? "descending" : "none");
    fireEvent.keyDown(header, { key: "Enter" });
    expect(onSort).toHaveBeenLastCalledWith(column);
  }
  expect(onSort).toHaveBeenCalledTimes(columns.length);
  for (const label of plain) {
    const header = screen.getByRole("columnheader", { name: label });
    expect(header).not.toHaveAttribute("tabindex");
    expect(header).not.toHaveAttribute("aria-sort");
  }
}

describe("procurement tables use the keyboard-sortable header", () => {
  it("Sourcing sorts from the keyboard and announces the direction", () => {
    const onSort = vi.fn();
    render(<SourcingTable
      displayed={[request]}
      licenses={[]}
      userSettings={{ dateFormat: "DD/MM/YYYY", timeZone: "UTC" }}
      perms={{ canEdit: false, canDelete: false }}
      mode="history"
      search=""
      setSearch={vi.fn()}
      selectedForMerge={new Set()}
      sortCol="supplier"
      sortDir="desc"
      onSort={onSort}
      onOpenDocuments={vi.fn()}
      onRefetch={vi.fn()}
    />);

    expectKeyboardSortable(
      [["Supplier", "supplier"], ["Publisher", "publisher"], ["Items", "itemCount"], ["Est. Total", "total"], ["Created", "created"]],
      onSort,
      { sorted: "supplier", plain: ["Status", "Reference"] },
    );
  });

  it("Pending Orders sorts from the keyboard and announces the direction", () => {
    const onSort = vi.fn();
    render(<PendingOrdersTable
      displayed={[order]}
      locale="en-US"
      settings={{ dateFormat: "DD/MM/YYYY", timeZone: "UTC" }}
      perms={{ canEdit: false, canDelete: false }}
      search=""
      setSearch={vi.fn()}
      sortCol="totalValue"
      sortDir="desc"
      onSort={onSort}
      onRowToggle={vi.fn()}
      onRefetch={vi.fn()}
    />);

    expectKeyboardSortable(
      [["Order", "poNumber"], ["Supplier", "supplier"], ["Publisher", "publisher"], ["Items", "itemCount"], ["Value", "totalValue"], ["Status", "status"], ["Created", "created"]],
      onSort,
      { sorted: "totalValue", plain: ["Actions"] },
    );
  });
});

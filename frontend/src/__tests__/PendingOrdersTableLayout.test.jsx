import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import PendingOrdersTable from "../components/pages/pendingOrders/PendingOrdersTable.jsx";
import { filterAndSortPendingOrders } from "../components/pages/pendingOrders/usePendingOrdersPageState.js";

test("pending overview shows publishers and the created date before actions", () => {
  render(<PendingOrdersTable
    displayed={[{
      id: 7,
      poNumber: "PO-7",
      supplier: "Example Supplier",
      createdAt: "2026-09-19T14:35:00Z",
      status: "pending",
      items: [
        { id: 1, publisherName: "Acme", softwareDescription: "Product A", currency: "EUR", quantity: "1" },
        { id: 2, publisherName: "Beta", softwareDescription: "Product B", currency: "EUR", quantity: "1" },
        { id: 3, publisherName: "Acme", softwareDescription: "Product C", currency: "EUR", quantity: "1" },
      ],
    }]}
    expandedPendingOrderId={7}
    locale="en-US"
    settings={{ dateFormat: "DD/MM/YYYY", timeZone: "UTC" }}
    perms={{ canEdit: false, canDelete: false }}
    search=""
    setSearch={vi.fn()}
    onSort={vi.fn()}
    onRowToggle={vi.fn()}
    onRefetch={vi.fn()}
  />);

  const headers = within(screen.getAllByRole("rowgroup")[0]).getAllByRole("columnheader");
  expect(headers.map((header) => header.textContent)).toEqual([
    "", "Order", "Supplier", "Publisher", "Items", "Value", "Status", "Created", "Actions",
  ]);
  expect(screen.getByText("Acme, Beta")).toBeInTheDocument();
  expect(screen.getByText("19/09/2026")).toHaveAttribute("title", "19/09/2026 14:35");
  expect(screen.getByText("Product A").closest("table").parentElement).toHaveAttribute("colspan", "9");
});

test("pending orders sort by their displayed publisher list", () => {
  const orders = [
    { id: 1, items: [{ publisherName: "Zulu" }] },
    { id: 2, items: [{ publisherName: "Alpha" }] },
  ];
  expect(filterAndSortPendingOrders(orders, "", "publisher", "asc").map((order) => order.id)).toEqual([2, 1]);
});

test("a manual PO total replaces the line value with an Override marker and line-sum tooltip", () => {
  render(<PendingOrdersTable
    displayed={[{
      id: 8,
      poNumber: "PO-8",
      status: "pending",
      poTotalOverride: "21000.00",
      items: [
        { id: 1, publisherName: "Acme", softwareDescription: "A", currency: "EUR", quantity: "1", estimatedTotalPrice: "0" },
        { id: 2, publisherName: "Acme", softwareDescription: "B", currency: "EUR", quantity: "1", estimatedTotalPrice: "0" },
      ],
    }]}
    locale="en-US"
    settings={{}}
    perms={{ canEdit: false, canDelete: false }}
    search=""
    setSearch={vi.fn()}
    onSort={vi.fn()}
    onRowToggle={vi.fn()}
    onRefetch={vi.fn()}
  />);

  const marker = screen.getByText("Override");
  expect(marker.parentElement).toHaveTextContent("€21,000.00");
  expect(marker.parentElement.getAttribute("title")).toMatch(/Line total: €0\.00/);
});

test("pending orders sort by the manual PO total when one is set", () => {
  const orders = [
    { id: 1, items: [{ estimatedTotalPrice: "500", currency: "EUR" }] },
    { id: 2, poTotalOverride: "100", items: [{ estimatedTotalPrice: "900", currency: "EUR" }] },
  ];
  expect(filterAndSortPendingOrders(orders, "", "totalValue", "asc").map((order) => order.id)).toEqual([2, 1]);
});

test("the order's lines list shows the generated line number first, gaps included", () => {
  render(<PendingOrdersTable
    displayed={[{
      id: 9,
      poNumber: "PO-9",
      status: "pending",
      items: [
        { id: 1, publisherName: "Acme", softwareDescription: "A", currency: "EUR", quantity: "1", poLineNumber: 1 },
        { id: 2, publisherName: "Acme", softwareDescription: "B", currency: "EUR", quantity: "1", poLineNumber: 2 },
        { id: 3, publisherName: "Acme", softwareDescription: "C", currency: "EUR", quantity: "1", poLineNumber: 4 },
      ],
    }]}
    expandedPendingOrderId={9}
    locale="en-US"
    settings={{}}
    perms={{ canEdit: false, canDelete: false }}
    search=""
    setSearch={vi.fn()}
    onSort={vi.fn()}
    onRowToggle={vi.fn()}
    onRefetch={vi.fn()}
  />);

  const lines = screen.getByText("A").closest("table");
  const headers = within(lines).getAllByRole("columnheader").map((header) => header.textContent);
  expect(headers[0]).toBe("Line");
  const firstCells = within(lines).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
  expect(firstCells).toEqual(["1", "2", "4"]);
});

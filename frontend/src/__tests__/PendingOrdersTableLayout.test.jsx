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

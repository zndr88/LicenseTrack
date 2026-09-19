import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import SourcingTable from "../components/pages/sourcing/SourcingTable.jsx";

test("sourcing overview shows publishers and a date with the full creation time on hover", () => {
  render(<SourcingTable
    displayed={[{
      id: 7,
      supplier: "Example Supplier",
      createdAt: "2026-09-19T14:35:00Z",
      status: "converted",
      items: [
        { id: 1, publisherName: "Acme", softwareDescription: "Product A", quantity: "3", quantityPerUnit: "2", estimatedUnitPrice: "10", estimatedTotalPrice: "30", currency: "EUR" },
        { id: 2, publisherName: "Beta", softwareDescription: "Product B", quantity: "1", quantityPerUnit: "1", estimatedUnitPrice: "20", estimatedTotalPrice: "20", currency: "USD" },
      ],
    }]}
    licenses={[]}
    userSettings={{ dateFormat: "DD/MM/YYYY", timeZone: "UTC" }}
    perms={{ canEdit: false, canDelete: false }}
    mode="history"
    search=""
    setSearch={vi.fn()}
    selectedForMerge={new Set()}
    expandedRequestId={7}
    onSort={vi.fn()}
    onOpenDocuments={vi.fn()}
    onRefetch={vi.fn()}
  />);

  const headers = within(screen.getAllByRole("rowgroup")[0]).getAllByRole("columnheader");
  expect(headers.map((header) => header.textContent)).toEqual([
    "", "Supplier", "Publisher", "Items", "Est. Total", "Status", "Created", "Reference",
  ]);
  expect(screen.getByText("Acme, Beta")).toBeInTheDocument();
  expect(screen.getByText("19/09/2026")).toHaveAttribute("title", "19/09/2026 14:35");
  const lineHeaders = within(screen.getAllByRole("rowgroup")[2]).getAllByRole("columnheader");
  expect(lineHeaders.map((header) => header.textContent)).toEqual([
    "", "Publisher", "Description", "Qty", "Unit Qty", "Est. Unit Price (EUR, USD)", "Est. Line Total (EUR, USD)", "Context",
  ]);
  expect(screen.getByText("Product A").closest("tr")).toHaveTextContent("3");
  expect(screen.getByText("Product A").closest("tr")).toHaveTextContent("2");
  expect(screen.getByText("Product A").closest("tr")).toHaveTextContent("€10.00");
  expect(screen.getByText("Product A").closest("tr")).toHaveTextContent("€30.00");
  expect(screen.getByText("Product B").closest("tr")).toHaveTextContent("$20.00");
  expect(screen.getByText("Product A").closest("tr")).not.toHaveTextContent("(EUR)");
});

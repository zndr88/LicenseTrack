import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseTableRowCells from "../components/pages/licenses/LicenseTableRowCells.jsx";

function renderCells(license, visibleColumns = [{ key: "docs" }]) {
  render(
    <table>
      <tbody>
        <tr>
          <LicenseTableRowCells
            license={license}
            visibleColumns={visibleColumns}
            selectedIds={new Set()}
            setSelectedIds={vi.fn()}
            licenses={[license]}
            customFieldValuesMap={new Map()}
            displayCurrency="EUR"
            userSettings={{ numberFormatLocale: "en-US" }}
            inlineEditEnabled={false}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("LicenseTableRowCells document count", () => {
  test("shows compact record count with a warning marker when files are unavailable", () => {
    renderCells({
      id: 1,
      documentCount: 3,
      availableDocumentCount: 2,
      missingDocumentCount: 1,
      unavailableDocumentCount: 0,
      completeness: { percentage: 100, isComplete: true },
      expiration: { status: "active", label: "Active" },
    });

    const count = screen.getByText("3*");
    expect(count).toBeInTheDocument();
    expect(count).toHaveAttribute("title", "1 document file(s) missing or unavailable");
  });

  test("shows only the record count when every file is available", () => {
    renderCells({
      id: 1,
      documentCount: 2,
      availableDocumentCount: 2,
      missingDocumentCount: 0,
      unavailableDocumentCount: 0,
      completeness: { percentage: 100, isComplete: true },
      expiration: { status: "active", label: "Active" },
    });

    expect(screen.getByText("2")).toHaveAttribute("title", "2 document record(s)");
  });
});

describe("LicenseTableRowCells record identity", () => {
  test("renders the canonical License Record ID column", () => {
    renderCells({
      id: 42,
      expiration: { status: "active", label: "Active" },
    }, [{ key: "recordId" }]);

    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("LicenseTableRowCells procurement milestone dates", () => {
  test("renders request and purchase dates without time-of-day", () => {
    renderCells({
      id: 1,
      requestDate: "2026-05-02T13:45:00Z",
      purchaseDate: "2026-05-04T09:15:00Z",
      expiration: { status: "active", label: "Active" },
    }, [{ key: "requestDate" }, { key: "purchaseDate" }]);

    expect(screen.getByText("02/05/2026")).toBeInTheDocument();
    expect(screen.getByText("04/05/2026")).toBeInTheDocument();
    expect(screen.queryByText(/13:45/)).not.toBeInTheDocument();
    expect(screen.queryByText(/09:15/)).not.toBeInTheDocument();
  });
});

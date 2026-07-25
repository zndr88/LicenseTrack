import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseTableRowCells from "../components/pages/licenses/LicenseTableRowCells.jsx";

function renderCells(license) {
  render(
    <table>
      <tbody>
        <tr>
          <LicenseTableRowCells
            license={license}
            visibleColumns={[{ key: "docs" }]}
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseTableRowCells from "../components/pages/licenses/LicenseTableRowCells.jsx";
import { rowStyle } from "../components/pages/licenses/licenseTableShared.js";

function renderCells(license, visibleColumns = [{ key: "docs" }], userSettings = { numberFormatLocale: "en-US" }, upcomingReplacement = false) {
  render(
    <table>
      <tbody>
        <tr>
          <LicenseTableRowCells
            license={license}
            upcomingReplacement={upcomingReplacement}
            visibleColumns={visibleColumns}
            selectedIds={new Set()}
            setSelectedIds={vi.fn()}
            licenses={[license]}
            customFieldValuesMap={new Map()}
            displayCurrency="EUR"
            userSettings={userSettings}
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

describe("LicenseTableRowCells overlapping renewal status", () => {
  test("replaces expiring urgency with the linked successor countdown", () => {
    renderCells({
      id: 1,
      expiration: { status: "expiring", label: "Expires in 10d" },
    }, [{ key: "expiration" }], {}, {
      label: "Renews in 14 days",
      hasCoverageGap: false,
    });

    expect(screen.getByText("Renews in 14 days")).toBeInTheDocument();
    expect(screen.queryByText("Expires in 10d")).not.toBeInTheDocument();
    expect(screen.queryByText("Upcoming replacement linked")).not.toBeInTheDocument();
  });

  test("keeps a visible warning when linked successor coverage has a gap", () => {
    renderCells({
      id: 1,
      expiration: { status: "expiring", label: "Expires in 10d" },
    }, [{ key: "expiration" }], {}, {
      label: "Renews in 14 days",
      hasCoverageGap: true,
    });

    expect(screen.getByText("Coverage gap")).toBeInTheDocument();
  });

  test.each([
    ["expiring", "Expires in 10d"],
    ["expired", "Expired 2d ago"],
  ])("renders %s and pending renewal badges together", (status, label) => {
    renderCells({
      id: 1,
      lifecycleStatus: "pending_renewal",
      expiration: { status, label },
    }, [{ key: "expiration" }]);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Pending Renewal")).toBeInTheDocument();
  });

  test.each([
    ["expiring", "var(--orange)"],
    ["expired", "var(--red)"],
  ])("keeps the pending shade with the %s urgency border", (status, borderColor) => {
    expect(rowStyle({
      lifecycleStatus: "pending_renewal",
      expiration: { status },
    })).toEqual({
      background: "var(--purple-dim)",
      borderLeft: `3px solid ${borderColor}`,
    });
  });
});

describe("LicenseTableRowCells quantities", () => {
  test("preserves canonical decimal precision", () => {
    renderCells({
      id: 1,
      quantity: "1234.123456789",
      expiration: { status: "active", label: "Active" },
    }, [{ key: "quantity" }]);

    expect(screen.getByText("1,234.123456789")).toBeInTheDocument();
  });

  test("uses the configured locale without truncating the fraction", () => {
    renderCells({
      id: 1,
      quantityPerUnit: "1234.56789",
      expiration: { status: "active", label: "Active" },
    }, [{ key: "quantityPerUnit" }], { numberFormatLocale: "de-DE" });

    expect(screen.getByText("1.234,56789")).toBeInTheDocument();
  });

  test("renders a dash for an invalid canonical quantity", () => {
    renderCells({
      id: 1,
      effectiveQuantity: "invalid",
      expiration: { status: "active", label: "Active" },
    }, [{ key: "effectiveQuantity" }]);

    expect(screen.getByText("-")).toBeInTheDocument();
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

  test("renders the created date without time-of-day in the overview column", () => {
    renderCells({
      id: 1,
      createdAt: "2026-05-02T13:45:00Z",
      expiration: { status: "active", label: "Active" },
    }, [{ key: "createdAt" }]);

    expect(screen.getByText("02/05/2026")).toBeInTheDocument();
    expect(screen.queryByText(/13:45/)).not.toBeInTheDocument();
  });
});

describe("LicenseTableRowCells calculated total", () => {
  test.each([
    [{ quantity: "", unitPrice: "100" }],
    [{ quantity: "5", unitPrice: "" }],
    [{ quantity: null, unitPrice: "100" }],
    [{ quantity: undefined, unitPrice: "100" }],
    [{ quantity: "invalid", unitPrice: "100" }],
  ])("renders a dash when an operand is missing or invalid: %o", (values) => {
    renderCells({ id: 1, ...values, expiration: { status: "active", label: "Active" } }, [{ key: "calcTotal" }]);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  test.each([
    [{ quantity: 0, unitPrice: 100 }],
    [{ quantity: "0", unitPrice: "100" }],
    [{ quantity: 5, unitPrice: "0" }],
  ])("renders a real zero total for valid zero operands: %o", (values) => {
    renderCells({ id: 1, ...values, currency: "EUR", expiration: { status: "active", label: "Active" } }, [{ key: "calcTotal" }]);
    expect(screen.getByText("€0.00")).toBeInTheDocument();
  });
});

describe("LicenseTableRowCells inline edit coverage", () => {
  const baseLicense = {
    id: 7,
    licenseType: "perpetual",
    currency: "EUR",
    contactEmail: "sales@vendor.test",
    budgetOwnerEmail: "",
    purchaseDate: "2026-03-04T00:00:00",
    portalUrl: "",
    maintenanceCoverage: "included",
    invoiceNumber: "INV-1",
    invoiceNumbers: ["INV-1"],
    completeness: { percentage: 100, isComplete: true },
    expiration: { status: "perpetual", label: "Perpetual" },
  };

  function renderInline(license, keys, onInlineFieldSave = vi.fn(async () => ({ ok: true }))) {
    render(
      <table>
        <tbody>
          <tr>
            <LicenseTableRowCells
              license={license}
              visibleColumns={keys.map((key) => ({ key, label: key }))}
              selectedIds={new Set()}
              setSelectedIds={vi.fn()}
              licenses={[license]}
              customFieldValuesMap={new Map()}
              displayCurrency="EUR"
              userSettings={{ numberFormatLocale: "en-US" }}
              inlineEditEnabled
              onInlineFieldSave={onInlineFieldSave}
            />
          </tr>
        </tbody>
      </table>,
    );
    return onInlineFieldSave;
  }

  test("contacts, currency, purchase date, coverage and a single invoice are inline-editable", () => {
    renderInline({ ...baseLicense, licenseType: "subscription" }, ["contactEmail", "budgetOwnerEmail", "currency", "purchaseDate", "maintenanceCoverage", "invoiceNumber"]);

    expect(screen.getByLabelText("Edit contactEmail")).toHaveValue("sales@vendor.test");
    expect(screen.getByLabelText("Edit budgetOwnerEmail")).toHaveValue("");
    const currency = screen.getByLabelText("Edit currency");
    expect(currency).toHaveValue("EUR");
    expect(Array.from(currency.options).map((option) => option.value)).not.toContain("");
    expect(screen.getByLabelText("Edit purchaseDate")).toHaveValue("2026-03-04");
    const coverage = screen.getByLabelText("Edit maintenanceCoverage");
    expect(coverage).toHaveValue("included");
    expect(Array.from(coverage.options).map((option) => option.value)).not.toContain("separately_tracked");
    expect(screen.getByLabelText("Edit invoiceNumber")).toHaveValue("INV-1");
  });

  test("saves the edited purchase date through the field patch", async () => {
    const onSave = renderInline(baseLicense, ["purchaseDate"]);
    const input = screen.getByLabelText("Edit purchaseDate");
    fireEvent.change(input, { target: { value: "2026-05-06" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "purchaseDate", "2026-05-06"));
  });

  test("several invoices, non-SaaS portal URL and maintenance coverage stay read-only", () => {
    renderInline(
      { ...baseLicense, licenseType: "maintenance", invoiceNumbers: ["INV-1", "INV-2"] },
      ["invoiceNumber", "portalUrl", "maintenanceCoverage"],
    );

    expect(screen.queryByLabelText("Edit invoiceNumber")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit portalUrl")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit maintenanceCoverage")).not.toBeInTheDocument();
  });

  test("portal URL is inline-editable on SaaS", () => {
    renderInline({ ...baseLicense, licenseType: "saas", portalUrl: "https://portal.test" }, ["portalUrl"]);
    expect(screen.getByLabelText("Edit portalUrl")).toHaveValue("https://portal.test");
  });
});

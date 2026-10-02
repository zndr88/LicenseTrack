import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const line = (id, poNumber) => ({
  id, poNumber, publisherName: "Okta", currency: "EUR", quantity: "1", unitPrice: "10",
  expiration: { status: "active" }, completeness: { isComplete: true },
});

const mocks = vi.hoisted(() => ({ data: { lines: [] }, patch: vi.fn() }));
mocks.data.lines = [line(1, "PO-1"), line(2, "PO-2")];

vi.mock("../components/pages/licenses/useLicensesPageData.js", () => ({
  useLicensesPageData: () => ({
    licenses: mocks.data.lines,
    licensesLoading: false,
    licensesError: null,
    loadLicenses: vi.fn(),
    apiStats: null,
    sourcingItems: [],
    pendingOrders: [],
    contracts: [],
    customFieldDefs: [],
    customFieldValuesMap: new Map(),
  }),
}));

vi.mock("../hooks/useLicenseData.js", () => ({
  useLicenseData: () => ({
    filtered: mocks.data.lines,
    sorted: mocks.data.lines,
    stats: { active: 2, upcoming: 0, expiring: 0, expired: 0, renewed: 0, legacy: 0 },
    enriched: mocks.data.lines,
    paginatedItems: mocks.data.lines,
    totalPages: 1,
    departments: [],
  }),
}));

vi.mock("../components/pages/licenses/LicenseTable.jsx", () => ({
  default: ({ groupRows, onInlineFieldSave }) => (
    <div>
      <div data-testid="rows">
        {(groupRows ?? []).map((row) => (row.type === "group" ? `G:${row.node.id}` : `L:${row.license.id}`)).join("|")}
      </div>
      <button type="button" onClick={() => onInlineFieldSave(1, "poNumber", "PO-2")}>edit line 1</button>
    </div>
  ),
}));

vi.mock("../components/pages/licenses/LicenseToolbar.jsx", () => ({
  default: ({ onToggleGroupStrip }) => <button type="button" onClick={onToggleGroupStrip}>Group columns</button>,
}));
vi.mock("../components/pages/licenses/LicenseStatusFilter.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/PipelineStrip.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/LicenseAttentionPanel.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/LicenseBulkActions.jsx", () => ({ default: () => null }));
vi.mock("../components/licenses/DetailPanel.jsx", () => ({ default: () => null }));
vi.mock("../hooks/useUserSettings.js", () => ({ useUserSettings: () => ({}) }));
vi.mock("../components/pages/licenses/useLicenseActions.js", () => ({
  useLicenseActions: () => ({
    handleLicenseUpdate: vi.fn(),
    handleLicenseFieldPatch: async (id, field, value) => {
      // Like the real action: the cache already holds the edit before the first await.
      mocks.data.lines = mocks.data.lines.map((l) => (l.id === id ? { ...l, [field]: value } : l));
      mocks.patch(id, field, value);
    },
    handleLicenseDelete: vi.fn(),
    handleCreateRenewal: vi.fn(),
    handleCancelRenewal: vi.fn(),
    handleBulkDelete: vi.fn(),
  }),
}));

import LicensesPage from "../components/pages/LicensesPage.jsx";

describe("LicensesPage grouping: inline edit", () => {
  test("a line edited into another group opens that group", async () => {
    render(
      <LicensesPage
        selectedId={null}
        setSelectedId={vi.fn()}
        user={{ role: "admin" }}
        userSettings={{ displayCurrency: "EUR", numberFormatLocale: "en-US", visibleInList: {}, columnOrder: [], savedViews: [] }}
        setUserSettings={vi.fn()}
        globalSettings={{}}
        showError={vi.fn()}
        showSuccess={vi.fn()}
        showToast={vi.fn()}
        fullView={false}
        onFullView={vi.fn()}
        statsVisible={false}
        onSetStatsVisible={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group columns" }));
    fireEvent.change(screen.getByLabelText("Add grouping"), { target: { value: "poNumber" } });
    expect(screen.getByTestId("rows")).toHaveTextContent("G:poNumber:po-1|G:poNumber:po-2");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "edit line 1" }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("rows")).toHaveTextContent("G:poNumber:po-2|L:1|L:2");
    });
    expect(mocks.patch).toHaveBeenCalledWith(1, "poNumber", "PO-2");
  });
});

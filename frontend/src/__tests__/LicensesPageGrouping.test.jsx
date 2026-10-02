import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportFilteredCsv: vi.fn(),
  userSettings: {
    handleSaveView: vi.fn(),
    handleDeleteView: vi.fn(),
    handleSetDefaultView: vi.fn(),
    handleLoadView: vi.fn(),
    handleHideColumn: vi.fn(),
    handleSetVisibleColumn: vi.fn(),
    handleSetVisibleColumnGroup: vi.fn(),
    handleRevertToDefault: vi.fn(),
  },
}));

const line = (id, poNumber) => ({
  id,
  poNumber,
  publisherName: "Okta",
  softwareDescription: `Item ${id}`,
  currency: "EUR",
  quantity: "1",
  unitPrice: "10",
  expiration: { status: "active", label: "Active" },
  completeness: { isComplete: true, percentage: 100 },
});
const LINES = [line(1, "PO-2"), line(2, "PO-1"), line(3, "PO-2")];

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 40, end: (index + 1) * 40 })),
    getTotalSize: () => count * 40,
  }),
}));

vi.mock("../components/pages/licenses/exportFilteredCsv.js", () => ({
  exportFilteredCsv: mocks.exportFilteredCsv,
}));

vi.mock("../components/pages/licenses/useLicensesPageData.js", () => ({
  useLicensesPageData: () => ({
    licenses: LINES,
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
    filtered: LINES,
    sorted: LINES,
    stats: { active: 3, upcoming: 0, expiring: 0, expired: 0, renewed: 0, legacy: 0 },
    enriched: LINES,
    paginatedItems: LINES,
    totalPages: 1,
    departments: [],
  }),
}));

vi.mock("../components/pages/licenses/LicenseStatusFilter.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/PipelineStrip.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/LicenseAttentionPanel.jsx", () => ({ default: () => null }));
vi.mock("../components/pages/licenses/LicenseBulkActions.jsx", () => ({ default: () => null }));
vi.mock("../components/licenses/DetailPanel.jsx", () => ({ default: () => null }));
vi.mock("../hooks/useUserSettings.js", () => ({ useUserSettings: () => mocks.userSettings }));
vi.mock("../components/pages/licenses/useLicenseActions.js", () => ({
  useLicenseActions: () => ({
    handleLicenseUpdate: vi.fn(),
    handleLicenseFieldPatch: vi.fn(),
    handleLicenseDelete: vi.fn(),
    handleCreateRenewal: vi.fn(),
    handleCancelRenewal: vi.fn(),
    handleBulkDelete: vi.fn(),
  }),
}));

import LicensesPage from "../components/pages/LicensesPage.jsx";

function renderLicensesPage() {
  return render(
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
}

function groupByPo() {
  fireEvent.click(screen.getByRole("button", { name: "Group columns" }));
  fireEvent.change(screen.getByLabelText("Add grouping"), { target: { value: "poNumber" } });
}

describe("LicensesPage grouping", () => {
  beforeEach(() => mocks.exportFilteredCsv.mockClear());

  test("grouping from the toolbar strip groups the table, and Expand all shows lines", async () => {
    renderLicensesPage();
    groupByPo();
    expect(await screen.findAllByRole("button", { name: /PO # · / })).toHaveLength(2);
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  test("the strip stays visible while grouped, even when the button is toggled off", () => {
    renderLicensesPage();
    groupByPo();
    fireEvent.click(screen.getByRole("button", { name: "Group columns" }));
    expect(screen.getByRole("region", { name: "Grouping" })).toBeInTheDocument();
  });

  test("CSV export receives lines in grouped order", async () => {
    renderLicensesPage();
    groupByPo();
    fireEvent.click(screen.getByLabelText("Export CSV"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export Current View.*Filtered rows and visible columns/ }));
    await waitFor(() => expect(mocks.exportFilteredCsv).toHaveBeenCalled());
    expect(mocks.exportFilteredCsv.mock.calls[0][0].map((l) => l.id)).toEqual([2, 1, 3]);
  });

  test("ungrouped export keeps the sorted order", async () => {
    renderLicensesPage();
    fireEvent.click(screen.getByLabelText("Export CSV"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export Full Data/ }));
    await waitFor(() => expect(mocks.exportFilteredCsv).toHaveBeenCalled());
    expect(mocks.exportFilteredCsv.mock.calls[0][0].map((l) => l.id)).toEqual([1, 2, 3]);
  });
});

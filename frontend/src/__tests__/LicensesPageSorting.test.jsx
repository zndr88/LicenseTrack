import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../components/pages/licenses/useLicensesPageData.js", () => ({
  useLicensesPageData: () => ({
    licenses: [
      { id: 1, publisherName: "Zulu", softwareDescription: "Zulu Suite" },
      { id: 2, publisherName: "Acme", softwareDescription: "Acme Suite" },
    ],
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
    filtered: [
      { id: 1, publisherName: "Zulu", softwareDescription: "Zulu Suite", expiration: { status: "active" }, completeness: { isComplete: true } },
      { id: 2, publisherName: "Acme", softwareDescription: "Acme Suite", expiration: { status: "active" }, completeness: { isComplete: true } },
    ],
    sorted: [
      { id: 2, publisherName: "Acme", softwareDescription: "Acme Suite", expiration: { status: "active" }, completeness: { isComplete: true } },
      { id: 1, publisherName: "Zulu", softwareDescription: "Zulu Suite", expiration: { status: "active" }, completeness: { isComplete: true } },
    ],
    stats: { active: 2, expiring: 0, expired: 0, renewed: 0, legacy: 0 },
    enriched: [],
    paginatedItems: [],
    totalPages: 1,
    departments: [],
  }),
}));

vi.mock("../components/pages/licenses/LicenseTable.jsx", () => ({
  default: ({ filtered }) => (
    <div data-testid="license-table-order">
      {filtered.map((license) => license.publisherName).join("|")}
    </div>
  ),
}));

vi.mock("../components/pages/licenses/LicenseToolbar.jsx", () => ({
  default: () => <div data-testid="license-toolbar" />,
}));

vi.mock("../components/pages/licenses/LicenseStatusFilter.jsx", () => ({
  default: () => <div data-testid="license-status-filter" />,
}));

vi.mock("../components/pages/licenses/PipelineStrip.jsx", () => ({
  default: () => <div data-testid="pipeline-strip" />,
}));

vi.mock("../components/pages/licenses/LicenseAttentionPanel.jsx", () => ({
  default: () => null,
}));

vi.mock("../components/pages/licenses/LicenseBulkActions.jsx", () => ({
  default: () => null,
}));

vi.mock("../components/licenses/DetailPanel.jsx", () => ({
  default: () => null,
}));

vi.mock("../hooks/useUserSettings.js", () => ({
  useUserSettings: () => ({
    handleSaveView: vi.fn(),
    handleDeleteView: vi.fn(),
    handleLoadView: vi.fn(),
    handleHideColumn: vi.fn(),
    handleRevertToDefault: vi.fn(),
  }),
}));

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

const userSettings = {
  displayCurrency: "EUR",
  numberFormatLocale: "en-US",
  visibleInList: {},
  columnOrder: [],
  savedViews: [],
};

describe("LicensesPage sorting handoff", () => {
  test("passes sorted rows to the table so virtualized rendering keeps the requested order", () => {
    render(
      <LicensesPage
        selectedId={null}
        setSelectedId={vi.fn()}
        user={{ id: 1, role: "admin" }}
        userSettings={userSettings}
        setUserSettings={vi.fn()}
        globalSettings={{ mandatoryFields: {}, notificationDays: 30 }}
        showError={vi.fn()}
        showSuccess={vi.fn()}
        showToast={vi.fn()}
        fullView={false}
        onFullView={vi.fn()}
        statsVisible={false}
        onSetStatsVisible={vi.fn()}
        onNavigateToSourcing={vi.fn()}
        onNavigateToPendingOrder={vi.fn()}
        onNavigateToContract={vi.fn()}
        onCreateContract={vi.fn()}
        onSourcingCreated={vi.fn()}
        onStatsChange={vi.fn()}
        onPortfolioStateChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("license-table-order")).toHaveTextContent("Acme|Zulu");
  });
});

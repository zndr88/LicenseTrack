import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

import AppRouter from "../AppRouter.jsx";

vi.mock("../components/pages/LicensesPage.jsx", () => ({ default: () => <div>Licenses page</div> }));
vi.mock("../components/pages/RenewalWorkbenchPage.jsx", () => ({ default: () => <div>Renewals page</div> }));
vi.mock("../components/pages/SourcingPage.jsx", () => ({ default: () => <div>Sourcing page</div> }));
vi.mock("../components/pages/PendingOrdersPage.jsx", () => ({ default: () => <div>Pending orders page</div> }));
vi.mock("../components/pages/NotificationsPage.jsx", () => ({ default: () => <div>Notifications page</div> }));
vi.mock("../components/pages/ReportsPage.jsx", () => ({ default: () => <div>Reports page</div> }));
vi.mock("../components/pages/SettingsPage.jsx", () => ({ default: () => <div>Settings page</div> }));
vi.mock("../components/pages/AdminPage.jsx", () => ({ default: () => <div>Admin page</div> }));
vi.mock("../components/pages/CSVImportPage.jsx", () => ({ default: () => <div>Import page</div> }));
vi.mock("../components/pages/ContractsPage.jsx", () => ({ default: () => <div>Contracts page</div> }));
vi.mock("../components/pages/HelpPage.jsx", () => ({ default: () => <div>Help page</div> }));

const baseProps = {
  setPage: vi.fn(),
  perms: { canUpload: true, canAdminSettings: true },
  currentUser: { id: 1, role: "admin" },
  userSettings: {},
  setUserSettings: vi.fn(),
  globalSettings: {},
  setGlobalSettings: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showToast: vi.fn(),
  confirmData: null,
  setConfirmData: vi.fn(),
  selectedId: null,
  setSelectedId: vi.fn(),
  handleSetSelectedId: vi.fn(),
  statsVisible: true,
  setStatsVisible: vi.fn(),
  notifications: [],
  licenseFullView: false,
  handleFullView: vi.fn(),
  highlightSourcingId: null,
  setHighlightSourcingId: vi.fn(),
  highlightPendingOrderId: null,
  setHighlightPendingOrderId: vi.fn(),
  openContractId: null,
  setOpenContractId: vi.fn(),
  handleConfirm: vi.fn(),
  handleCreateContract: vi.fn(),
  handleRegisterNavGuard: vi.fn(),
  handleSettingsDiscard: vi.fn(),
  handleSectionSaved: vi.fn(),
  handleSidebarStatsChange: vi.fn(),
};

function renderRouter(props) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppRouter {...baseProps} {...props} />
    </QueryClientProvider>,
  );
}

describe("AppRouter permissions", () => {
  test("blocks viewer users from procurement and notification routes", () => {
    renderRouter({
      page: "sourcing",
      currentUser: { id: 2, role: "viewer" },
    });

    expect(screen.queryByText("Sourcing page")).not.toBeInTheDocument();
  });

  test("opens the manual add-license modal only with upload permission", () => {
    const confirmData = { publisherName: "", strategyUsed: "manual", currency: "EUR", fileName: "manual-entry" };
    const userSettings = { numberFormatLocale: "en-US", visibleInDetail: {} };

    const { rerender } = renderRouter({
      page: "licenses",
      perms: { canUpload: false, canAdminSettings: false },
      confirmData,
      userSettings,
    });
    expect(screen.queryByRole("dialog", { name: /review license data/i })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppRouter {...baseProps} page="licenses" perms={{ canUpload: true, canAdminSettings: false }} confirmData={confirmData} userSettings={userSettings} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("dialog", { name: /review license data/i })).toBeInTheDocument();
  });

  test("requires admin permission for admin route", () => {
    renderRouter({
      page: "admin",
      perms: { canUpload: true, canAdminSettings: false },
    });

    expect(screen.queryByText("Admin page")).not.toBeInTheDocument();
  });

  test("allows reports and contracts for routed users", async () => {
    const { rerender } = renderRouter({ page: "reports" });
    expect(await screen.findByText("Reports page")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppRouter {...baseProps} page="contracts" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Contracts page")).toBeInTheDocument();
  });

  test("allows help for all routed users", async () => {
    renderRouter({
      page: "help",
      currentUser: { id: 2, role: "viewer" },
      perms: { canUpload: false, canAdminSettings: false },
    });

    expect(await screen.findByText("Help page")).toBeInTheDocument();
  });
});

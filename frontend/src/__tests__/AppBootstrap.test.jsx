import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

import App from "../App.jsx";

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
import * as authApi from "../api/auth.js";
import * as licensesApi from "../api/licenses.js";
import * as notificationsApi from "../api/notifications.js";
import * as pendingOrdersApi from "../api/pendingOrders.js";
import * as settingsApi from "../api/settings.js";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../components/layout/Sidebar.jsx", () => ({
  default: () => <nav aria-label="Sidebar" />,
}));

vi.mock("../components/layout/TopBar.jsx", () => ({
  default: () => <header>Top bar</header>,
}));

vi.mock("../components/pages/LicensesPage.jsx", () => ({
  default: () => <div>Licenses route</div>,
}));

vi.mock("../components/auth/LoginScreen.jsx", () => ({
  default: () => <div>Login screen</div>,
}));

vi.mock("../components/auth/ChangePasswordModal.jsx", () => ({
  default: () => <div>Change password</div>,
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: () => <span />,
}));

vi.mock("../api/auth.js", () => ({
  getSession: vi.fn(),
  logoutSession: vi.fn(),
}));

vi.mock("../api/licenses.js", () => ({
  createLicenseBatch: vi.fn(),
  getLicenseProcurementTrail: vi.fn().mockResolvedValue({ data: null, error: null }),
  getStats: vi.fn(),
}));

vi.mock("../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn(),
}));

vi.mock("../api/notifications.js", () => ({
  getNotifications: vi.fn(),
}));

vi.mock("../api/settings.js", () => ({
  getSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
  getGlobalSettingsPublic: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../api/contracts.js", () => ({
  createContract: vi.fn(),
}));

describe("App bootstrap", () => {
  test("loads authenticated app data once after the current user resolves", async () => {
    authApi.getSession.mockResolvedValue({
      data: {
        authenticated: true,
        user: {
          id: 1,
          username: "admin",
          role: "admin",
          must_change_password: false,
          auth_provider: "local",
        },
      },
      error: null,
    });
    notificationsApi.getNotifications.mockResolvedValue({ data: [], error: null });
    settingsApi.getSettings.mockResolvedValue({ data: {}, error: null });
    settingsApi.getGlobalSettings.mockResolvedValue({ data: {}, error: null });
    licensesApi.getStats.mockResolvedValue({
      data: {
        total_active: 5,
        total_expiring: 1,
        total_expired: 0,
        total_renewed: 2,
      },
      error: null,
    });
    pendingOrdersApi.getPendingOrders.mockResolvedValue({ data: [], error: null });

    renderApp();

    expect(await screen.findByText("Licenses route")).toBeInTheDocument();

    await waitFor(() => {
      expect(notificationsApi.getNotifications).toHaveBeenCalledTimes(1);
      expect(settingsApi.getSettings).toHaveBeenCalledTimes(1);
      expect(settingsApi.getGlobalSettings).toHaveBeenCalledTimes(1);
      expect(licensesApi.getStats).toHaveBeenCalledTimes(1);
      expect(pendingOrdersApi.getPendingOrders).toHaveBeenCalledTimes(1);
    });
  });

  test("renders login screen after anonymous session probe without loading app data", async () => {
    authApi.getSession.mockResolvedValue({
      data: { authenticated: false, user: null },
      error: null,
    });

    renderApp();

    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(notificationsApi.getNotifications).not.toHaveBeenCalled();
    expect(settingsApi.getSettings).not.toHaveBeenCalled();
    expect(licensesApi.getStats).not.toHaveBeenCalled();
    expect(pendingOrdersApi.getPendingOrders).not.toHaveBeenCalled();
  });
});

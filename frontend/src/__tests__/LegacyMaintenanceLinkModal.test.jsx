import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import LegacyMaintenanceLinkModal from "../components/licenses/LegacyMaintenanceLinkModal.jsx";
import { getLicense, linkMaintenanceToParent } from "../api/licenses.js";

vi.mock("../api/licenses.js", () => ({
  getLicense: vi.fn(),
  linkMaintenanceToParent: vi.fn(),
}));

const license = { id: 7, licenseType: "maintenance", isLegacyUnlinkedMaintenance: true };
const parent = { id: 42, licenseType: "perpetual", licenseRef: "LT-42", publisherName: "Acme", softwareDescription: "Suite" };

function renderModal(props) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><LegacyMaintenanceLinkModal {...props} /></QueryClientProvider>);
}

describe("LegacyMaintenanceLinkModal", () => {
  test("links successfully after refreshing the maintenance record", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    linkMaintenanceToParent.mockResolvedValueOnce({ data: {}, error: null });
    getLicense.mockResolvedValueOnce({ data: { ...license, isLegacyUnlinkedMaintenance: false }, error: null });

    renderModal({ license, allLicenses: [parent], onSuccess, onClose: vi.fn() });
    await user.click(screen.getByRole("option", { name: /LT-42/i }));
    await user.click(screen.getByRole("button", { name: /link maintenance/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ isLegacyUnlinkedMaintenance: false }), 42
    ));
    expect(linkMaintenanceToParent).toHaveBeenCalledWith(42, 7);
  });

  test("shows API errors without closing or reporting success", async () => {
    const user = userEvent.setup();
    linkMaintenanceToParent.mockResolvedValueOnce({ data: null, error: "Parent is retired" });
    const onSuccess = vi.fn();
    renderModal({ license, allLicenses: [parent], onSuccess, onClose: vi.fn() });
    await user.click(screen.getByRole("option", { name: /LT-42/i }));
    await user.click(screen.getByRole("button", { name: /link maintenance/i }));

    expect(await screen.findByText("Parent is retired")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("reports a completed link when the follow-up refresh fails and disables repeat mutation", async () => {
    const user = userEvent.setup();
    linkMaintenanceToParent.mockResolvedValueOnce({ data: {}, error: null });
    getLicense.mockResolvedValueOnce({ data: null, error: "Refresh failed" });
    renderModal({ license, allLicenses: [parent], onSuccess: vi.fn(), onClose: vi.fn() });
    await user.click(screen.getByRole("option", { name: /LT-42/i }));
    await user.click(screen.getByRole("button", { name: /link maintenance/i }));

    expect(await screen.findByText(/linked, but the refreshed record could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /link maintenance/i })).toBeDisabled();
  });
});

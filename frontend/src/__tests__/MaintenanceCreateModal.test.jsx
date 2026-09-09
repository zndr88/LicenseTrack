import React from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import MaintenanceCreateModal from "../components/licenses/MaintenanceCreateModal.jsx";
import { createLicense, linkMaintenanceToParent } from "../api/licenses.js";
import { uploadDocument } from "../api/documents.js";

vi.mock("../api/documents.js", () => ({ uploadDocument: vi.fn() }));
vi.mock("../components/ui/LocalDocumentPreviewPanel.jsx", () => ({ default: () => null }));

function render(ui, options) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>, ...options });
}

vi.mock("../api/licenses.js", () => ({
  createLicense: vi.fn(),
  linkMaintenanceToParent: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

const parentLicense = {
  id: 42,
  publisherName: "Acme",
  softwareDescription: "Acme Suite",
  licenseMetric: "per_device",
  quantity: "25",
  currency: "USD",
  supplier: "Acme Support",
  contactEmail: "vendor@example.com",
  budgetOwnerEmail: "owner@example.com",
  costCentre: "IT",
};

const userSettings = {
  numberFormatLocale: "en-US",
  displayCurrency: "EUR",
};

describe("MaintenanceCreateModal", () => {
  test("closing after an upload failure refreshes the created record", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    createLicense.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    uploadDocument.mockRejectedValueOnce(new Error("Upload unavailable"));
    render(<MaintenanceCreateModal parentLicense={parentLicense} userSettings={userSettings} onSuccess={onSuccess} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-12-31" } });
    await user.upload(screen.getByLabelText("Upload Quote Document"), new File(["quote"], "quote.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: /create maintenance \/ support record/i }));
    expect(await screen.findByText(/Maintenance record created. Retry/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^close$/i })[0]);
    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onSuccess).toHaveBeenCalledWith(42);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("retries only failed documents without recreating maintenance", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    createLicense.mockClear();
    uploadDocument.mockReset();
    createLicense.mockResolvedValueOnce({ data: { id: 99 }, error: null });
    uploadDocument.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: "Upload unavailable" })
      .mockResolvedValueOnce({ error: null });
    render(<MaintenanceCreateModal parentLicense={parentLicense} userSettings={userSettings} onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-12-31" } });
    const quote = new File(["quote"], "quote.txt", { type: "text/plain" });
    const eula = new File(["eula"], "eula.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Upload Quote Document"), quote);
    await user.upload(screen.getByLabelText("Upload EULA Document"), eula);
    await user.click(screen.getByRole("button", { name: /create maintenance \/ support record/i }));
    expect(await screen.findByText(/Maintenance record created. Retry/)).toBeInTheDocument();
    expect(uploadDocument).toHaveBeenNthCalledWith(1, 99, quote, "quote", "shared");
    expect(uploadDocument).toHaveBeenNthCalledWith(2, 99, eula, "eula", "license");
    expect(screen.getByLabelText(/po number/i)).toBeDisabled();
    expect(screen.getByRole("tab", { name: /link existing/i })).toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /retry document uploads/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(42));
    expect(createLicense).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(3);
    expect(uploadDocument).toHaveBeenLastCalledWith(99, eula, "eula", "license");
  });

  test("renders parent-derived fields and defaults", () => {
    render(
      <MaintenanceCreateModal
        parentLicense={parentLicense}
        userSettings={userSettings}
        onSuccess={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /add maintenance \/ support contract/i })).toBeInTheDocument();
    expect(screen.getByText(/Acme - Acme Suite/)).toBeInTheDocument();
    expect(screen.getByLabelText(/supplier/i)).toHaveValue("Acme Support");
    expect(screen.getByRole("button", { name: /create maintenance \/ support record/i })).toBeDisabled();
  });

  test("successful submit calls createLicense and onSuccess with the same payload/result behavior", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    createLicense.mockResolvedValueOnce({ data: { id: 99 }, error: null });

    render(
      <MaintenanceCreateModal
        parentLicense={parentLicense}
        userSettings={userSettings}
        onSuccess={onSuccess}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    await user.type(screen.getByLabelText(/support cost/i), "2500.50");
    await user.type(screen.getByLabelText(/po number/i), "PO-123");
    await user.type(screen.getByLabelText(/contract number/i), "C-123");
    await user.clear(screen.getByLabelText(/supplier/i));
    await user.type(screen.getByLabelText(/supplier/i), "Support Partner");
    await user.click(screen.getByRole("button", { name: /create maintenance \/ support record/i }));

    await waitFor(() => {
      expect(createLicense).toHaveBeenCalledWith({
        publisherName: "Acme",
        softwareDescription: "Acme Suite - Maintenance",
        licenseType: "maintenance",
        licenseMetric: "per_device",
        parentLicenseId: 42,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        quantity: "25",
        unitPrice: "2500.50",
        totalPoPrice: "2500.50",
        currency: "USD",
        poNumber: "PO-123",
        contractNumber: "C-123",
        supplier: "Support Partner",
        contactEmail: "vendor@example.com",
        budgetOwnerEmail: "owner@example.com",
        costCentre: "IT",
      });
      expect(onSuccess).toHaveBeenCalledWith(42);
    });
  });

  test("API error is displayed and onSuccess is not called", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    createLicense.mockResolvedValueOnce({ data: null, error: "Could not create maintenance" });

    render(
      <MaintenanceCreateModal
        parentLicense={parentLicense}
        userSettings={userSettings}
        onSuccess={onSuccess}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-12-31" } });
    await user.click(screen.getByRole("button", { name: /create maintenance \/ support record/i }));

    expect(await screen.findByText("Could not create maintenance")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("link existing mode calls link API with selected maintenance record", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    linkMaintenanceToParent.mockResolvedValueOnce({ data: { id: 42 }, error: null });

    render(
      <MaintenanceCreateModal
        parentLicense={parentLicense}
        userSettings={userSettings}
        allLicenses={[
          {
            id: 77,
            parentLicenseId: 42,
            licenseRef: "LT-2026-0077",
            publisherName: "Acme",
            softwareDescription: "Acme Suite Maintenance",
            licenseType: "maintenance",
            poNumber: "PO-77",
            contractNumber: "CTR-77",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            maintenanceParentIds: [],
            isRetired: false,
            isLegacyUnlinkedMaintenance: true,
          },
        ]}
        onSuccess={onSuccess}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole("tab", { name: /link existing/i }));
    expect(screen.queryByLabelText("Upload Quote Document")).not.toBeInTheDocument();
    expect(screen.getByText("Legacy unlinked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /LT-2026-0077/i }));
    await user.click(screen.getByRole("button", { name: /link existing record/i }));

    await waitFor(() => {
      expect(linkMaintenanceToParent).toHaveBeenCalledWith(42, 77);
      expect(onSuccess).toHaveBeenCalledWith(42);
    });
  });

  test("cancel, close, and overlay behavior remains equivalent", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MaintenanceCreateModal
        parentLicense={parentLicense}
        userSettings={userSettings}
        onSuccess={vi.fn()}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(document.querySelector(".overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

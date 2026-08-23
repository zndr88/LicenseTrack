import React from "react";
import { cleanup, render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import PendingOrderModal from "../components/procurement/PendingOrderModal.jsx";
import ConvertSourcingModal from "../components/procurement/ConvertSourcingModal.jsx";
import ConvertPendingOrderModal from "../components/procurement/ConvertPendingOrderModal.jsx";
import ConvertAllModal from "../components/procurement/ConvertAllModal.jsx";
import * as pendingOrdersApi from "../api/pendingOrders.js";
import { buildConvertItemDefaults } from "../utils/buildConvertItemDefaults.js";

function render(ui, options) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>, ...options });
}

vi.mock("../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn().mockResolvedValue({ data: [] }),
}));

beforeEach(() => {
  pendingOrdersApi.getPendingOrders.mockResolvedValue({ data: [] });
});

afterEach(() => {
  cleanup();
});

const USER_SETTINGS = {
  numberFormatLocale: "en-US",
  visibleInDetail: {
    supplier: true, costCentre: true, licenseType: true, licenseMetric: true,
    quantity: true, skuCode: true, unitPrice: true, totalPoPrice: true, notes: true,
  },
};

// ─── PendingOrderModal ────────────────────────────────────────────────────────

describe("PendingOrderModal", () => {
  function renderModal(props = {}) {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<PendingOrderModal onSave={onSave} onCancel={onCancel} {...props} />);
    return { onSave, onCancel };
  }

  test("Save remains enabled when PO Number is empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  test("Save becomes enabled when PO Number is filled", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "PO-001" } });
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  test("calls onSave with correct payload shape", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "PO-001" } });
    fireEvent.change(screen.getByPlaceholderText(/reseller or direct supplier/i), { target: { value: "Vendor X" } });
    fireEvent.change(screen.getByPlaceholderText(/PO notes/i), { target: { value: "Note here" } });

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // New-order submit also carries the multi-item PO fields (items[] + optional quoteFile).
    const payload = onSave.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      poNumber: "PO-001",
      procurementReference: "",
      supplier: "Vendor X",
      notes: "Note here",
    }));
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload).toHaveProperty("quoteFile", null);
  });

  test("Cancel calls onCancel immediately when untouched", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("close button and overlay call onCancel immediately when untouched", () => {
    let { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.click(screen.getByRole("dialog", { name: /add pending order/i }).parentElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Cancel shows discard dialog when form is dirty", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("dirty close button and overlay show discard dialog instead of closing", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /add pending order/i }).parentElement);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("Discard from dialog calls onCancel", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Escape uses the same dirty guard close behavior", async () => {
    const user = userEvent.setup();
    let { onCancel } = renderModal();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ─── ConvertSourcingModal ─────────────────────────────────────────────────────

describe("ConvertSourcingModal", () => {
  const ITEM = { publisherName: "Acme", softwareDescription: "Acme Suite", supplier: "SoftwareOne" };

  function renderModal(props = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConvertSourcingModal item={ITEM} onConfirm={onConfirm} onCancel={onCancel} {...props} />);
    return { onConfirm, onCancel };
  }

  test("Convert is disabled when supplier is empty in new mode", () => {
    renderModal({ item: { ...ITEM, supplier: "" } });
    expect(screen.getByRole("button", { name: /convert/i })).toBeDisabled();
  });

  test("Convert is enabled with supplier even when PO Number is empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /convert/i })).not.toBeDisabled();
  });

  test("new mode calls onConfirm with poNumber, supplier, notes (nulls for empty optionals)", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "PO-42" } });
    await user.click(screen.getByRole("button", { name: /convert/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({
      poNumber: "PO-42",
      procurementReference: "",
      supplier: "SoftwareOne",
      notes: null,
    });
  });

  test("existing pending order mode loads orders and submits the selected id", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [
        { id: 7, poNumber: "PO-7", supplier: "Supplier A" },
        { id: 9, poNumber: "PO-9", supplier: "Supplier B" },
      ],
    });
    const { onConfirm } = renderModal();

    await waitFor(() => expect(screen.getByRole("button", { name: /add to existing/i })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: /add to existing/i }));
    expect(screen.getByLabelText(/select pending order/i)).toHaveValue("7");

    await user.selectOptions(screen.getByLabelText(/select pending order/i), "9");
    await user.click(screen.getByRole("button", { name: /convert/i }));

    expect(onConfirm).toHaveBeenCalledWith({ pendingOrderId: 9 });
  });

  test("Cancel calls onCancel immediately when untouched", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("close button and overlay call onCancel immediately when untouched", () => {
    let { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.click(screen.getByRole("dialog", { name: /convert to pending order/i }).parentElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Cancel shows discard dialog when PO Number was typed", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("dirty close button and overlay show discard dialog instead of closing", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /convert to pending order/i }).parentElement);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("switching mode marks the modal dirty and confirming discard closes it", async () => {
    const user = userEvent.setup();
    pendingOrdersApi.getPendingOrders.mockResolvedValueOnce({
      data: [{ id: 7, poNumber: "PO-7", supplier: "Supplier A" }],
    });
    const { onCancel } = renderModal();

    await waitFor(() => expect(screen.getByRole("button", { name: /add to existing/i })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: /add to existing/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Escape uses the same dirty guard close behavior", async () => {
    const user = userEvent.setup();
    let { onCancel } = renderModal();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByPlaceholderText(/PO-2026/i), { target: { value: "X" } });
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ─── ConvertPendingOrderModal ─────────────────────────────────────────────────

describe("ConvertPendingOrderModal", () => {
  const ORDER = { id: 1, poNumber: "PO-1", items: [] };
  // Include totalPoPrice so the auto-compute effect doesn't dirty the form on mount.
  const PREFILL = {
    publisherName: "Acme Corp",
    softwareDescription: "Acme Suite",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    quantity: "10",
    unitPrice: "25.00",
    totalPoPrice: "250.00",
    currency: "EUR",
  };

  function renderModal(props = {}) {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <ConvertPendingOrderModal
        order={ORDER}
        prefill={PREFILL}
        userSettings={USER_SETTINGS}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    );
    return { onConfirm, onCancel };
  }

  test("Save is disabled when publisher is empty", () => {
    renderModal({ prefill: { ...PREFILL, publisherName: "" } });
    expect(screen.getByRole("button", { name: /confirm & create license/i })).toBeDisabled();
  });

  test("Save is enabled when required fields are filled", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /confirm & create license/i })).not.toBeDisabled();
  });

  test("invalid contact email blocks submit and shows error", async () => {
    const { onConfirm } = renderModal();

    const emailInput = screen.getByLabelText(/^contact email$/i);
    fireEvent.change(emailInput, { target: { value: "bad-email" } });

    fireEvent.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid email/i)).toBeInTheDocument()
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("valid email is accepted and onConfirm called", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  test("valid submit payload shape remains identical", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      prefill: {
        ...PREFILL,
        publisherName: " Acme Corp ",
        softwareDescription: " Acme Suite ",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        contractNumber: "CN-1",
        poNumber: "PO-1",
        invoiceNumber: "INV-1",
        contactEmail: "owner@example.com",
        supplier: "Supplier A",
        costCentre: "IT",
        licenseType: "saas",
        licenseMetric: "per_user",
        portalUrl: "https://portal.example.com",
        skuCode: "SKU-1",
        budgetOwnerEmail: "budget@example.com",
        notes: "Ship it",
      },
    });

    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({
      publisherName: "Acme Corp",
      softwareDescription: "Acme Suite",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      purchaseDate: null,
      contractNumber: "CN-1",
      poNumber: "PO-1",
      procurementReference: "",
      invoiceNumber: "INV-1",
      contactEmail: "owner@example.com",
      supplier: "Supplier A",
      costCentre: "IT",
      licenseType: "saas",
      licenseMetric: "per_user",
      portalUrl: "https://portal.example.com",
      maintenanceCoverage: "unknown",
      maintenanceStartDate: null,
      maintenanceEndDate: null,
      maintenancePricingBasis: "flat",
      maintenanceQuantity: null,
      maintenanceUnitPrice: null,
      maintenanceCost: null,
      quantity: "10",
      quantityPerUnit: "1",
      skuCode: "SKU-1",
      unitPrice: "25.00",
      totalPoPrice: "250.00",
      currency: "EUR",
      budgetOwnerEmail: "budget@example.com",
      notes: "Ship it",
    }, null);
  });

  test("included subscription support mirrors conversion term and PO total", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      prefill: {
        ...PREFILL,
        licenseType: "subscription",
        maintenanceCoverage: "unknown",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        unitPrice: "50.00",
        totalPoPrice: "500.00",
      },
    });

    await user.selectOptions(screen.getByLabelText(/^coverage$/i), "included");
    await waitFor(() => {
      expect(screen.queryByLabelText(/coverage start/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/coverage end/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/total support cost/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual(expect.objectContaining({
      maintenanceCoverage: "included",
      maintenanceStartDate: "2026-01-01",
      maintenanceEndDate: "2026-12-31",
      maintenanceCost: "500.00",
    }));
  });

  test("perpetual checkbox keeps end date valid and sets license type", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      prefill: {
        ...PREFILL,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        purchaseDate: null,
      },
    });

    await user.click(screen.getByRole("checkbox", { name: /perpetual license/i }));
    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual(expect.objectContaining({
      endDate: null,
      licenseType: "perpetual",
    }));
  });

  test("selecting perpetual license type creates a perpetual license", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      prefill: {
        ...PREFILL,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
    });

    await user.selectOptions(screen.getByLabelText(/license type/i), "perpetual");
    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual(expect.objectContaining({
      endDate: null,
      licenseType: "perpetual",
    }));
  });

  test("maintenance conversion requires an existing parent license selection", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({
      licenses: [{
        id: 501,
        licenseRef: "LT-0501",
        publisherName: "Acme Corp",
        softwareDescription: "Acme Platform",
        licenseType: "perpetual",
        startDate: "2026-01-01",
      }],
    });

    await user.selectOptions(screen.getByLabelText(/license type/i), "maintenance");
    expect(screen.getByRole("button", { name: /confirm & create license/i })).toBeDisabled();

    await user.click(screen.getByRole("option", { name: /LT-0501 .* Acme Platform/i }));
    await user.click(screen.getByRole("button", { name: /confirm & create license/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual(expect.objectContaining({
      licenseType: "maintenance",
      parentLicenseId: 501,
    }));
  });

  test("Cancel calls onCancel immediately when untouched", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("clean close button, overlay, and Escape call onCancel immediately", async () => {
    const user = userEvent.setup();
    let { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.click(screen.getByRole("dialog", { name: /convert to license/i }).parentElement);
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    ({ onCancel } = renderModal());
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Cancel shows discard dialog after editing a field", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByDisplayValue("Acme Corp"), { target: { value: "Changed" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("dirty close button, overlay, and Escape show discard dialog", async () => {
    const user = userEvent.setup();
    let { onCancel } = renderModal();
    fireEvent.change(screen.getByDisplayValue("Acme Corp"), { target: { value: "Changed" } });
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByDisplayValue("Acme Corp"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("dialog", { name: /convert to license/i }).parentElement);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByDisplayValue("Acme Corp"), { target: { value: "Changed" } });
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

});

// ─── ConvertAllModal ──────────────────────────────────────────────────────────

describe("ConvertAllModal", () => {
  const ORDER = {
    id: 1,
    poNumber: "PO-1",
    items: [
      {
        id: 11,
        publisherName: "Acme Corp",
        softwareDescription: "Acme Suite",
        quantity: "10",
        estimatedUnitPrice: "25.00",
        estimatedTotalPrice: "250.00",
        currency: "EUR",
      },
    ],
  };
  const MULTI_ORDER = {
    id: 2,
    poNumber: "PO-2",
    supplier: "Order Supplier",
    items: [
      {
        id: 21,
        publisherName: "SaaS Co",
        softwareDescription: "SaaS App",
        quantity: "4",
        estimatedUnitPrice: "12.50",
        estimatedTotalPrice: "50.00",
        currency: "USD",
      },
      {
        id: 22,
        publisherName: "Renew Co",
        softwareDescription: "Renew App",
        quantity: "7",
        estimatedUnitPrice: "30.00",
        estimatedTotalPrice: "210.00",
        currency: "EUR",
        isRenewal: true,
        renewalForLicenseId: 101,
      },
    ],
  };
  const RENEWAL_LICENSES = [
    {
      id: 101,
      contractNumber: "CN-OLD",
      contactEmail: "renew@example.com",
      supplier: "Renew Supplier",
      costCentre: "Renewals",
      licenseType: "saas",
      licenseMetric: "per_device",
      portalUrl: "https://renew.example.com",
      quantity: "9",
      skuCode: "SKU-OLD",
      unitPrice: "99.00",
      totalPoPrice: "891.00",
      currency: "GBP",
      budgetOwnerEmail: "budget-renew@example.com",
    },
  ];

  function renderModal(props = {}) {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <ConvertAllModal
        order={ORDER}
        licenses={[]}
        userSettings={USER_SETTINGS}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    );
    return { onConfirm, onCancel };
  }

  test("Confirm is disabled when item is missing startDate", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /confirm & create licenses/i })).toBeDisabled();
  });

  test("single and batch conversion show equivalent defaults for a one-line coterm order", () => {
    const cotermOrder = {
      id: 3,
      poNumber: "PO-COTERM",
      supplier: "PO Supplier",
      notes: "PO note",
      items: [{
        id: 31,
        publisherName: "Current Publisher",
        softwareDescription: "Current Product",
        licenseType: "saas",
        quantity: "12",
        estimatedUnitPrice: "55.00",
        estimatedTotalPrice: "660.00",
        currency: "USD",
        startDate: "2026-03-01",
        endDate: "2027-02-28",
        supplier: "Line Supplier",
        contactEmail: "line@example.com",
        notes: "Line note",
        isRenewal: true,
        renewalForLicenseId: 101,
        cotermPredecessorIds: [101, 102],
      }],
    };
    const licenses = [{
      ...RENEWAL_LICENSES[0],
      notes: "Previous note",
    }];
    const [singleDefaults] = buildConvertItemDefaults(cotermOrder, licenses);

    render(
      <ConvertPendingOrderModal
        order={cotermOrder}
        prefill={singleDefaults}
        licenses={licenses}
        userSettings={USER_SETTINGS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const singleValues = {
      publisherName: screen.getByLabelText(/publisher name/i).value,
      softwareDescription: screen.getByLabelText(/software description/i).value,
      startDate: screen.getByLabelText(/start date/i).value,
      endDate: screen.getByLabelText(/^end date/i).value,
      contactEmail: screen.getByLabelText(/^contact email$/i).value,
      supplier: screen.getByLabelText(/^supplier$/i).value,
      licenseType: screen.getByLabelText(/license type/i).value,
      licenseMetric: screen.getByLabelText(/license metric/i).value,
      quantity: screen.getByLabelText(/purchase quantity/i).value,
      unitPrice: screen.getByLabelText(/^unit price/i).value,
      totalPoPrice: screen.getByLabelText(/total po price/i).value,
      currency: screen.getByLabelText(/^currency$/i).value,
      notes: screen.getByLabelText(/notes \/ comments/i).value,
    };

    cleanup();
    renderModal({ order: cotermOrder, licenses });
    const batchValues = {
      publisherName: screen.getByLabelText(/publisher name/i).value,
      softwareDescription: screen.getByLabelText(/software description/i).value,
      startDate: screen.getByLabelText(/start date/i).value,
      endDate: screen.getByLabelText(/^end date/i).value,
      contactEmail: screen.getByLabelText(/^contact email$/i).value,
      supplier: screen.getByLabelText(/^supplier$/i).value,
      licenseType: screen.getByLabelText(/license type/i).value,
      licenseMetric: screen.getByLabelText(/license metric/i).value,
      quantity: screen.getByLabelText(/purchase quantity/i).value,
      unitPrice: screen.getByLabelText(/^unit price/i).value,
      totalPoPrice: screen.getByLabelText(/total po price/i).value,
      currency: screen.getByLabelText(/^currency$/i).value,
      notes: screen.getByLabelText(/notes \/ comments/i).value,
    };

    expect(batchValues).toEqual(singleValues);
    expect(batchValues).toEqual(expect.objectContaining({
      startDate: "2026-03-01",
      endDate: "2027-02-28",
      licenseType: "saas",
      licenseMetric: "per_device",
      quantity: "12",
      unitPrice: "55.00",
      totalPoPrice: "660.00",
      supplier: "PO Supplier",
      contactEmail: "line@example.com",
      currency: "USD",
      notes:
        "Purchase order notes:\nPO note\n\n" +
        "Line item notes:\nLine note\n\n" +
        "Previous license notes:\nPrevious note",
    }));
  });

  test("copies shared fields from the first item across the remaining conversion items", async () => {
    const user = userEvent.setup();
    renderModal({ order: MULTI_ORDER, licenses: RENEWAL_LICENSES });

    const copyButton = screen.getByRole("button", { name: /copy shared fields from first item/i });
    expect(copyButton).toHaveAttribute("title", expect.stringMatching(/overwrite/i));
    expect(copyButton).toHaveAttribute("title", expect.stringMatching(/review every license/i));

    const contractNumbers = screen.getAllByLabelText(/^contract number$/i);
    const invoiceNumbers = screen.getAllByLabelText(/^invoice number$/i);
    const contactEmails = screen.getAllByLabelText(/^contact email$/i);
    const suppliers = screen.getAllByLabelText(/^supplier$/i);
    const costCentres = screen.getAllByLabelText(/^cost centre$/i);
    const currencies = screen.getAllByLabelText(/^currency$/i);
    const budgetOwners = screen.getAllByLabelText(/^budget owner email$/i);

    fireEvent.change(contractNumbers[0], { target: { value: "CN-SHARED" } });
    fireEvent.change(invoiceNumbers[0], { target: { value: "INV-SHARED" } });
    fireEvent.change(contactEmails[0], { target: { value: "shared@example.com" } });
    fireEvent.change(suppliers[0], { target: { value: "Shared Supplier" } });
    fireEvent.change(costCentres[0], { target: { value: "Shared Cost Centre" } });
    await user.selectOptions(currencies[0], "GBP");
    fireEvent.change(budgetOwners[0], { target: { value: "shared.budget@example.com" } });

    expect(contractNumbers[1]).toHaveValue("CN-OLD");
    expect(contactEmails[1]).toHaveValue("renew@example.com");
    expect(suppliers[1]).toHaveValue("Order Supplier");

    await user.click(copyButton);

    expect(contractNumbers[1]).toHaveValue("CN-SHARED");
    expect(invoiceNumbers[1]).toHaveValue("INV-SHARED");
    expect(contactEmails[1]).toHaveValue("shared@example.com");
    expect(suppliers[1]).toHaveValue("Shared Supplier");
    expect(costCentres[1]).toHaveValue("Shared Cost Centre");
    expect(currencies[1]).toHaveValue("GBP");
    expect(budgetOwners[1]).toHaveValue("shared.budget@example.com");
  });

  test("Confirm is enabled when all required fields are filled", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^end date/i), { target: { value: "2026-12-31" } });
    expect(screen.getByRole("button", { name: /confirm & create licenses/i })).not.toBeDisabled();
  });

  test("invalid contactEmail shows per-item error and blocks submit", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^end date/i), { target: { value: "2026-12-31" } });

    const emailInput = screen.getByLabelText(/contact email/i);
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });

    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid email/i)).toBeInTheDocument()
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("submits correct payload with sourcingItemId", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^end date/i), { target: { value: "2026-12-31" } });

    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      1,
      [expect.objectContaining({ sourcingItemId: 11, publisherName: "Acme Corp" })],
      null
    );
  });

  test("passes an uploaded invoice file to batch conversion", async () => {
    const user = userEvent.setup();
    const invoice = new File(["invoice"], "invoice.pdf", { type: "application/pdf" });
    const { onConfirm } = renderModal();

    await user.upload(screen.getByLabelText(/invoice document/i), invoice);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^end date/i), { target: { value: "2026-12-31" } });
    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toBe(1);
    expect(onConfirm.mock.calls[0][2]).toBe(invoice);
  });

  test("submits preserved PO and line-item notes", async () => {
    const user = userEvent.setup();
    const order = {
      ...ORDER,
      notes: "PO-level context",
      items: [{ ...ORDER.items[0], notes: "Line-level context" }],
    };
    const { onConfirm } = renderModal({ order });

    expect(screen.getByLabelText(/notes \/ comments/i)).toHaveValue(
      "Purchase order notes:\nPO-level context\n\nLine item notes:\nLine-level context"
    );

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^end date/i), { target: { value: "2026-12-31" } });
    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][1][0].notes).toBe(
      "Purchase order notes:\nPO-level context\n\nLine item notes:\nLine-level context"
    );
  });

  test("selecting perpetual license type in batch conversion clears end date", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    await user.selectOptions(screen.getByLabelText(/license type/i), "perpetual");
    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      1,
      [expect.objectContaining({
        sourcingItemId: 11,
        endDate: null,
        licenseType: "perpetual",
      })],
      null
    );
  });

  test("maintenance item can link to a perpetual item in the same PO", async () => {
    const user = userEvent.setup();
    const order = {
      ...MULTI_ORDER,
      items: MULTI_ORDER.items.map((item) => ({ ...item, isRenewal: false, renewalForLicenseId: null })),
    };
    const { onConfirm } = renderModal({ order, licenses: [] });

    const startDates = screen.getAllByLabelText(/start date/i);
    const endDates = screen.getAllByLabelText(/^end date/i);
    fireEvent.change(startDates[0], { target: { value: "2026-01-01" } });
    fireEvent.change(startDates[1], { target: { value: "2026-02-01" } });
    fireEvent.change(endDates[1], { target: { value: "2027-01-31" } });

    const licenseTypes = screen.getAllByLabelText(/license type/i);
    await user.selectOptions(licenseTypes[0], "perpetual");
    await user.selectOptions(licenseTypes[1], "maintenance");
    expect(screen.getByRole("button", { name: /confirm & create licenses/i })).toBeDisabled();

    await user.click(screen.getByRole("option", { name: /PO row 1 .* SaaS App/i }));
    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][1][1]).toEqual(expect.objectContaining({
      licenseType: "maintenance",
      parentSourcingItemId: 21,
    }));
  });

  test("valid submit payload shape remains identical for multiple items", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({ order: MULTI_ORDER, licenses: RENEWAL_LICENSES });

    const startDates = screen.getAllByLabelText(/start date/i);
    const endDates = screen.getAllByLabelText(/^end date/i);
    fireEvent.change(startDates[0], { target: { value: "2026-01-01" } });
    fireEvent.change(endDates[0], { target: { value: "2026-12-31" } });
    fireEvent.change(startDates[1], { target: { value: "2026-02-01" } });
    fireEvent.change(endDates[1], { target: { value: "2027-01-31" } });
    await user.selectOptions(screen.getAllByLabelText(/license type/i)[0], "saas");
    fireEvent.change(screen.getAllByLabelText(/portal url/i)[0], { target: { value: "https://saas.example.com" } });

    await user.click(screen.getByRole("button", { name: /confirm & create licenses/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      2,
      [
        {
          sourcingItemId: 21,
          publisherName: "SaaS Co",
          softwareDescription: "SaaS App",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          purchaseDate: null,
          contractNumber: "",
          poNumber: "PO-2",
          procurementReference: "",
          invoiceNumber: "",
          contactEmail: "",
          supplier: "Order Supplier",
          costCentre: "",
          licenseType: "saas",
          licenseMetric: "per_user",
          portalUrl: "https://saas.example.com",
          maintenanceCoverage: "unknown",
          maintenanceStartDate: null,
          maintenanceEndDate: null,
          maintenancePricingBasis: "flat",
          maintenanceQuantity: null,
          maintenanceUnitPrice: null,
          maintenanceCost: null,
          quantity: "4",
          quantityPerUnit: "1",
          skuCode: "",
          unitPrice: "12.50",
          totalPoPrice: "50.00",
          currency: "USD",
          budgetOwnerEmail: "",
          notes: null,
        },
        {
          sourcingItemId: 22,
          publisherName: "Renew Co",
          softwareDescription: "Renew App",
          startDate: "2026-02-01",
          endDate: "2027-01-31",
          purchaseDate: null,
          contractNumber: "CN-OLD",
          poNumber: "PO-2",
          procurementReference: "",
          invoiceNumber: "",
          contactEmail: "renew@example.com",
          supplier: "Order Supplier",
          costCentre: "Renewals",
          licenseType: "saas",
          licenseMetric: "per_device",
          portalUrl: "https://renew.example.com",
          maintenanceCoverage: "included",
          maintenanceStartDate: "2026-02-01",
          maintenanceEndDate: "2027-01-31",
          maintenancePricingBasis: "flat",
          maintenanceQuantity: null,
          maintenanceUnitPrice: null,
          maintenanceCost: "210.00",
          quantity: "7",
          quantityPerUnit: "1",
          skuCode: "SKU-OLD",
          unitPrice: "30.00",
          totalPoPrice: "210.00",
          currency: "EUR",
          budgetOwnerEmail: "budget-renew@example.com",
          notes: null,
        },
      ],
      null,
    );
  });

  test("preserves per-item SaaS portal URL, price display, and renewal defaults", () => {
    renderModal({ order: MULTI_ORDER, licenses: RENEWAL_LICENSES });

    expect(screen.getByDisplayValue("12.50")).toBeInTheDocument();
    expect(screen.getByDisplayValue("210.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://renew.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("CN-OLD")).toBeInTheDocument();
    expect(screen.getByText("Renewal")).toBeInTheDocument();
  });

  test("Cancel calls onCancel immediately when untouched", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Cancel shows discard dialog after editing a field", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("dirty close button, overlay, and Escape show discard dialog", async () => {
    const user = userEvent.setup();
    let { onCancel } = renderModal();
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("dialog", { name: /convert po/i }).parentElement);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    cleanup();
    ({ onCancel } = renderModal());
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

});

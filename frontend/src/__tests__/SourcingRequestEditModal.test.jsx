import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import SourcingRequestEditModal from "../components/procurement/SourcingRequestEditModal.jsx";

const customFieldState = vi.hoisted(() => ({ definitions: [] }));

vi.mock("../hooks/useCustomFieldDefinitions.js", () => ({
  useCustomFieldDefinitions: () => ({ definitions: customFieldState.definitions, loading: false }),
}));

const request = {
  id: 12,
  supplier: "SoftwareOne",
  contactEmail: "sales@example.com",
  notes: "Request note",
  items: [{
    id: 44,
    status: "requested",
    publisherName: "Acme",
    softwareDescription: "Acme Suite",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    quantityPerUnit: "1",
    estimatedUnitPrice: "25.00",
    estimatedTotalPrice: "250.00",
    currency: "EUR",
    purchaseDate: "2026-08-15",
    invoiceNumber: "LEGACY-INV",
    externalRef: "LEGACY-EXT",
    secondaryContacts: [],
    customFieldValues: [],
  }],
};

function renderModal(requestValue = request) {
  const onSave = vi.fn().mockResolvedValue(true);
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SourcingRequestEditModal
        request={requestValue}
        userSettings={{ numberFormatLocale: "en-US" }}
        onSave={onSave}
        onCancel={onCancel}
      />
    </QueryClientProvider>
  );
  return { onSave, onCancel };
}

describe("SourcingRequestEditModal", () => {
  beforeEach(() => {
    customFieldState.definitions = [];
  });

  test("uses the sectioned procurement modal baseline and sourcing-stage fields", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Edit Sourcing Request" });
    expect(dialog).toHaveClass("document-assisted-modal", "sourcing-request-edit-modal");
    expect(screen.getByRole("button", { name: "Request Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Key Dates & Contract" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Relationships" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Purchase Date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invoice Number")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("External Reference")).not.toBeInTheDocument();
  });

  test("preserves hidden legacy values when an open line is edited", async () => {
    const { onSave, onCancel } = renderModal();
    fireEvent.change(screen.getByLabelText(/^Software Description/), { target: { value: "Acme Suite Pro" } });
    const saveButton = screen.getByRole("button", { name: "Save Sourcing Request" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].items[0]).toEqual(expect.objectContaining({
      softwareDescription: "Acme Suite Pro",
      purchaseDate: "2026-08-15",
      invoiceNumber: "LEGACY-INV",
      externalRef: "LEGACY-EXT",
    }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("omits custom fields configured as hidden from renewal lines", () => {
    customFieldState.definitions = [
      { id: 1, name: "Renewal owner", fieldType: "text", section: "identity", renewalBehavior: "clear" },
      { id: 2, name: "Historical approval", fieldType: "text", section: "identity", renewalBehavior: "hide" },
    ];
    renderModal({
      ...request,
      items: [{ ...request.items[0], isRenewal: true }],
    });

    expect(screen.getByLabelText("Renewal owner")).toBeInTheDocument();
    expect(screen.queryByLabelText("Historical approval")).not.toBeInTheDocument();
  });

  test("omits sourcing-hidden custom fields from ordinary and renewal lines", () => {
    customFieldState.definitions = [
      { id: 1, name: "Sourcing owner", fieldType: "text", section: "identity", showOnSourcingForms: true },
      { id: 2, name: "Invoice date", fieldType: "date", section: "dates", showOnSourcingForms: false },
    ];
    renderModal();

    expect(screen.getByLabelText("Sourcing owner")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoice date")).not.toBeInTheDocument();
  });
});

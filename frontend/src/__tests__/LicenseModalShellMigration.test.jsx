import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import FieldEditModal from "../components/licenses/FieldEditModal.jsx";
import InvoiceConfirmModal from "../components/licenses/InvoiceConfirmModal.jsx";
import { patchLicenseField } from "../api/licenses.js";

vi.mock("../api/licenses.js", () => ({
  patchLicenseField: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

const userSettings = {
  numberFormatLocale: "en-US",
  visibleInDetail: {
    supplier: true,
    costCentre: true,
    licenseType: true,
    licenseMetric: true,
    quantity: true,
    skuCode: true,
    unitPrice: true,
    totalPoPrice: true,
    notes: true,
  },
};

describe("license modal shell migration", () => {
  test("FieldEditModal renders the current value and saves the same payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    patchLicenseField.mockResolvedValueOnce({
      data: { id: 1, supplier: "New Supplier" },
      error: null,
    });

    render(
      <FieldEditModal
        licenseId={1}
        fieldKey="supplier"
        fieldLabel="Supplier"
        currentValue="Old Supplier"
        inputType="text"
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue("Old Supplier");
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "New Supplier");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchLicenseField).toHaveBeenCalledWith(1, "supplier", "New Supplier");
      expect(onSave).toHaveBeenCalledWith({ id: 1, supplier: "New Supplier" });
    });
  });

  test("FieldEditModal cancel, close, overlay, and Escape still close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <FieldEditModal
        licenseId={1}
        fieldKey="supplier"
        fieldLabel="Supplier"
        currentValue="Old Supplier"
        inputType="text"
        onSave={vi.fn()}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <FieldEditModal
        licenseId={1}
        fieldKey="supplier"
        fieldLabel="Supplier"
        currentValue="Old Supplier"
        inputType="text"
        onSave={vi.fn()}
        onClose={onClose}
      />
    );
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(document.querySelector(".overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(screen.getByDisplayValue("Old Supplier"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  test("InvoiceConfirmModal renders key invoice fields and submits the same payload shape", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <InvoiceConfirmModal
        data={{
          publisherName: "Acme",
          softwareDescription: "Acme Suite",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          invoiceNumber: "INV-1",
          quantity: "10",
          unitPrice: "5",
          totalPoPrice: "50",
          currency: "EUR",
          fileName: "invoice.pdf",
          strategyUsed: "manual",
        }}
        userSettings={userSettings}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /review license data/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme Suite")).toBeInTheDocument();
    expect(screen.getByDisplayValue("INV-1")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/budget owner email/i));
    await user.type(screen.getByLabelText(/budget owner email/i), "owner@example.com");
    await user.click(screen.getByRole("button", { name: /save license/i }));

    // onConfirm is called as (allForms, attachedFile, category); allForms is an
    // array of license rows (multi-line support), so assert against the first row.
    const [allForms, attachedFile, category] = onConfirm.mock.calls[0];
    expect(allForms[0]).toEqual(expect.objectContaining({
      publisherName: "Acme",
      softwareDescription: "Acme Suite",
      invoiceNumber: "INV-1",
      budgetOwnerEmail: "owner@example.com",
    }));
    expect(attachedFile).toBeNull();
    expect(category).toBe("invoice");
  });

  test("additional perpetual lines can add their own linked maintenance companion", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <InvoiceConfirmModal
        data={{
          publisherName: "Acme",
          softwareDescription: "Subscription Suite",
          licenseType: "subscription",
          licenseMetric: "per_user",
          poNumber: "PO-MANUAL-1",
          currency: "EUR",
          fileName: "manual-entry",
          strategyUsed: "manual",
        }}
        userSettings={userSettings}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /add additional license line/i }));
    await user.type(screen.getAllByLabelText(/software description/i)[1], "Perpetual Add-on");
    await user.selectOptions(screen.getAllByLabelText(/^license type$/i)[1], "perpetual");
    await user.selectOptions(screen.getAllByLabelText(/^coverage$/i)[1], "separately_tracked");
    await user.click(screen.getByRole("button", { name: /^add maintenance line$/i }));
    await user.click(screen.getByRole("button", { name: /save 3 licenses/i }));

    const [allForms] = onConfirm.mock.calls[0];
    expect(allForms[1]).toEqual(expect.objectContaining({
      softwareDescription: "Perpetual Add-on",
      licenseType: "perpetual",
      maintenanceCoverage: "separately_tracked",
    }));
    expect(allForms[2]).toEqual(expect.objectContaining({
      licenseType: "maintenance",
      parentLineIndex: 1,
    }));
  });

  test("additional-line prices use the selected number locale and submit canonical decimals", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <InvoiceConfirmModal
        data={{
          publisherName: "Acme",
          softwareDescription: "Localized Suite",
          licenseType: "subscription",
          licenseMetric: "per_user",
          poNumber: "PO-MANUAL-2",
          currency: "EUR",
          fileName: "manual-entry",
          strategyUsed: "manual",
        }}
        userSettings={{ ...userSettings, numberFormatLocale: "nl-BE" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /add additional license line/i }));
    expect(screen.getByText(/shared across all 2 licenses in this batch/i)).toBeInTheDocument();

    const additionalUnitPrice = screen.getAllByLabelText(/^unit price$/i)[1];
    const additionalTotalPrice = screen.getAllByLabelText(/^total po price$/i)[1];
    expect(additionalUnitPrice).toHaveAttribute("placeholder", "0,00");
    expect(additionalTotalPrice).toHaveAttribute("placeholder", "0,00");

    await user.type(additionalUnitPrice, "1.234,50");
    await user.type(additionalTotalPrice, "2.469,00");
    await user.click(screen.getByRole("button", { name: /save 2 licenses/i }));

    const [allForms] = onConfirm.mock.calls[0];
    expect(allForms[1]).toEqual(expect.objectContaining({
      unitPrice: "1234.50",
      totalPoPrice: "2469.00",
    }));
  });

  test("InvoiceConfirmModal synchronously locks repeated submissions", () => {
    const onConfirm = vi.fn(() => new Promise(() => {}));
    render(
      <InvoiceConfirmModal
        data={{
          publisherName: "Acme",
          softwareDescription: "Acme Suite",
          fileName: "invoice.pdf",
          strategyUsed: "manual",
        }}
        userSettings={userSettings}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const saveButton = screen.getByRole("button", { name: /save license/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeDisabled();
  });

  test("InvoiceConfirmModal cancel, close, and overlay still cancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <InvoiceConfirmModal
        data={{
          publisherName: "Acme",
          softwareDescription: "Acme Suite",
          fileName: "invoice.pdf",
          strategyUsed: "manual",
        }}
        userSettings={userSettings}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(document.querySelector(".overlay"));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});

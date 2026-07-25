import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect, vi } from "vitest";
import SourcingItemModal from "../components/procurement/SourcingItemModal.jsx";

const USER_SETTINGS = { numberFormatLocale: "en-US" };

const VALID_ITEM = {
  publisherName: "Acme Corp",
  softwareDescription: "Acme Suite",
  quantity: "10",
  estimatedUnitPrice: "25.00",
  estimatedTotalPrice: "250.00",
  currency: "EUR",
  supplier: "SoftwareOne",
  contactEmail: "sales@softwareone.com",
  notes: "Annual contract",
};

function renderModal(props = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <SourcingItemModal
      userSettings={USER_SETTINGS}
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onSave, onCancel };
}

// ─── Required fields ──────────────────────────────────────────────────────────

describe("required field validation", () => {
  test("Save button is disabled when publisher is empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  test("Save button is disabled when only publisher is filled", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), {
      target: { value: "Acme" },
    });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  test("Save button becomes enabled once both required fields are filled", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByPlaceholderText(/product or service name/i), { target: { value: "Acme Suite" } });
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  test("does not call onSave when form is new and required fields are blank", () => {
    const { onSave } = renderModal();
    // Save button is disabled — clicking it produces no effect
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  test("does not call onSave when publisher is empty (button disabled)", () => {
    const { onSave } = renderModal();
    // Clicking a disabled button should not fire events
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(onSave).not.toHaveBeenCalled();
  });
});

// ─── Email validation ─────────────────────────────────────────────────────────

describe("contact email validation", () => {
  test("invalid email blocks submit and shows an error", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({ item: { ...VALID_ITEM, contactEmail: "" } });

    // Fill invalid email — Save is enabled because required fields come from item
    await user.clear(screen.getByPlaceholderText(/contact@example\.com/i));
    await user.type(screen.getByPlaceholderText(/contact@example\.com/i), "not-an-email");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  test("empty contact email is accepted (optional field)", async () => {
    const { onSave } = renderModal({ item: { ...VALID_ITEM, contactEmail: "" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/valid email/i)).not.toBeInTheDocument();
  });

  test("valid email is accepted", async () => {
    const { onSave } = renderModal({ item: VALID_ITEM });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Payload shape ────────────────────────────────────────────────────────────

describe("request supplier context", () => {
  test("falls back to request supplier and contact when compatibility line fields are blank", () => {
    renderModal({
      item: { ...VALID_ITEM, id: 42, supplier: null, contactEmail: null },
      requestId: 7,
      sourcingRequest: {
        id: 7,
        supplier: "Request Reseller",
        contactEmail: "request@example.test",
      },
    });

    expect(screen.getByLabelText(/request supplier/i)).toHaveValue("Request Reseller");
    expect(screen.getByLabelText(/contact email/i)).toHaveValue("request@example.test");
    expect(screen.getByText(/applies to every line/i)).toBeInTheDocument();
  });

  test("clears a stale contact when the request supplier changes", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({
      item: { ...VALID_ITEM, id: 42 },
      requestId: 7,
      sourcingRequest: { id: 7, supplier: "SoftwareOne", contactEmail: "sales@softwareone.com" },
    });

    const supplier = screen.getByLabelText(/request supplier/i);
    await user.clear(supplier);
    await user.type(supplier, "Adobe Direct");
    expect(screen.getByLabelText(/contact email/i)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      supplier: "Adobe Direct",
      contactEmail: "",
    }));
  });
});

describe("onSave payload shape", () => {
  test("displays and saves a stored fractional quantity using the selected locale", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({
      item: { ...VALID_ITEM, id: 42, quantity: "3.75" },
      requestId: 7,
      userSettings: { numberFormatLocale: "de-DE" },
    });

    expect(screen.getByLabelText(/purchase quantity/i)).toHaveValue("3,75");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      quantity: "3.75",
    }));
  });

  test("freeware hides acquisition pricing and saves it as zero-cost", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({ item: VALID_ITEM });

    expect(screen.getByLabelText(/est\. unit price/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/license type/i), "freeware");

    expect(screen.queryByLabelText(/est\. unit price/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/est\. total price/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].items[0]).toEqual(expect.objectContaining({
      licenseType: "freeware",
      estimatedUnitPrice: null,
      estimatedTotalPrice: null,
    }));
  });

  test("included support can calculate a per-unit coverage total", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({
      item: { ...VALID_ITEM, licenseType: "freeware" },
    });

    await user.selectOptions(screen.getByLabelText(/^coverage$/i), "included");
    await user.selectOptions(screen.getByLabelText(/pricing basis/i), "per_unit");
    expect(screen.getByLabelText(/covered quantity/i)).toHaveValue("10");

    await user.type(screen.getByLabelText(/support unit price/i), "12.50");
    expect(screen.getByLabelText(/^total support cost$/i)).toHaveValue("125.00");

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].items[0]).toEqual(expect.objectContaining({
      maintenancePricingBasis: "per_unit",
      maintenanceQuantity: "10",
      maintenanceUnitPrice: "12.50",
      maintenanceCost: "125.00",
    }));
  });

  test("separately tracked support adds a linked maintenance line", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({
      item: { ...VALID_ITEM, licenseType: "freeware" },
    });

    await user.selectOptions(screen.getByLabelText(/^coverage$/i), "separately_tracked");
    await user.click(screen.getByRole("button", { name: /add maintenance line/i }));

    expect(screen.getByDisplayValue("Acme Suite maintenance/support")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save 2 lines/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].items[1]).toEqual(expect.objectContaining({
      licenseType: "maintenance",
      parentItemIndex: 0,
      publisherName: "Acme Corp",
      quantity: "10",
    }));
  });

  test("new request onSave emits a request payload wrapping a single item line", async () => {
    const { onSave } = renderModal({ item: VALID_ITEM });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // New requests (no id, no parent request) go through the request-create path:
    // request-level fields at the top, line fields under items[], plus optional quoteFile.
    const payload = onSave.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ["items", "supplier", "contactEmail", "notes", "quoteFile"].sort()
    );
    expect(payload.items).toHaveLength(1);
    expect(Object.keys(payload.items[0]).sort()).toEqual(
      [
        "publisherName",
        "softwareDescription",
        "licenseType",
        "maintenanceCoverage",
        "maintenanceStartDate",
        "maintenanceEndDate",
        "maintenancePricingBasis",
        "maintenanceQuantity",
        "maintenanceUnitPrice",
        "maintenanceCost",
        "quantity",
        "estimatedUnitPrice",
        "estimatedTotalPrice",
        "currency",
        "startDate",
        "endDate",
      ].sort()
    );
  });

  test("passes string values matching the input data", async () => {
    const { onSave } = renderModal({ item: VALID_ITEM });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const payload = onSave.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      supplier: "SoftwareOne",
      contactEmail: "sales@softwareone.com",
      notes: "Annual contract",
    }));
    expect(payload.items[0]).toEqual(expect.objectContaining({
      publisherName: "Acme Corp",
      softwareDescription: "Acme Suite",
      currency: "EUR",
    }));
  });

  test("new (blank) item saves with nulled optional fields under items[]", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "TestPub" } });
    fireEvent.change(screen.getByPlaceholderText(/product or service name/i), { target: { value: "TestSoft" } });

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const payload = onSave.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      supplier: null,
      contactEmail: null,
      notes: null,
      quoteFile: null,
    }));
    expect(payload.items[0]).toEqual(expect.objectContaining({
      publisherName: "TestPub",
      softwareDescription: "TestSoft",
      quantity: null,
      estimatedUnitPrice: null,
      estimatedTotalPrice: null,
      currency: "EUR",
    }));
  });

  test("normalizes localized number fields for additional request lines", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({ userSettings: { numberFormatLocale: "de-DE" } });

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "Primary Pub" } });
    fireEvent.change(screen.getByPlaceholderText(/product or service name/i), { target: { value: "Primary Suite" } });

    await user.click(screen.getByRole("button", { name: /add additional license line/i }));
    fireEvent.change(screen.getAllByPlaceholderText(/software publisher/i)[1], { target: { value: "Extra Pub" } });
    fireEvent.change(screen.getAllByPlaceholderText(/product or service name/i)[1], { target: { value: "Extra Suite" } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 10/i), { target: { value: "1.000" } });
    fireEvent.change(screen.getByPlaceholderText(/unit price/i), { target: { value: "1.234,50" } });
    fireEvent.change(screen.getByPlaceholderText(/total price/i), { target: { value: "1.234.500,00" } });

    await user.click(screen.getByRole("button", { name: /save 2 lines/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload.items[1]).toEqual(expect.objectContaining({
      quantity: "1000",
      estimatedUnitPrice: "1234.50",
      estimatedTotalPrice: "1234500.00",
    }));
  });
});

// ─── Dirty close guard ────────────────────────────────────────────────────────

describe("dirty close guard", () => {
  test("Cancel calls onCancel immediately when form is untouched", () => {
    const { onCancel } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
  });

  test("Cancel shows discard dialog when a field has been changed", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "A" } });

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("choosing Keep Editing from discard dialog dismisses it without closing", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "A" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));

    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("choosing Discard from discard dialog calls onCancel", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "A" } });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("clean close button, overlay, and Escape call onCancel immediately", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog", { name: /add sourcing item/i }).parentElement);
    expect(onCancel).toHaveBeenCalledTimes(2);

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  test("dirty close button, overlay, and Escape show discard dialog", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    fireEvent.change(screen.getByPlaceholderText(/software publisher/i), { target: { value: "A" } });

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /add sourcing item/i }).parentElement);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("currency display state", () => {
  test("formats unit and computed total price with the user locale while preserving submitted raw values", async () => {
    const { onSave } = renderModal({
      userSettings: { numberFormatLocale: "de-DE" },
      item: {
        ...VALID_ITEM,
        quantity: "2",
        estimatedUnitPrice: "1234.5",
        estimatedTotalPrice: "",
      },
    });

    expect(screen.getByDisplayValue("1.234,50")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2.469,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload.items[0]).toEqual(expect.objectContaining({
      estimatedUnitPrice: "1234.5",
      estimatedTotalPrice: "2469.00",
      currency: "EUR",
    }));
  });
});

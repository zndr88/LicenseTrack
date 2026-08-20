import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConvertSourcingModal from "../components/procurement/ConvertSourcingModal.jsx";
import { getPendingOrders } from "../api/pendingOrders.js";

vi.mock("../api/pendingOrders.js", () => ({
  getPendingOrders: vi.fn(),
}));

const REQUEST = {
  id: 12,
  supplier: "",
  items: [{ id: 31 }, { id: 32 }],
};

function renderWithQueryClient(ui) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe("ConvertSourcingModal supplier contract", () => {
  beforeEach(() => {
    getPendingOrders.mockResolvedValue({ data: [] });
  });

  it("requires one supplier when creating a pending order", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(true);
    renderWithQueryClient(
      <ConvertSourcingModal
        item={REQUEST}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/po number/i), "PO-NEW");
    expect(screen.getByRole("button", { name: /^convert$/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/^supplier/i), "Adobe Direct");
    await user.type(screen.getByLabelText(/procurement reference/i), "REQ-NEW");
    await user.click(screen.getByRole("button", { name: /^convert$/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      poNumber: "PO-NEW",
      procurementReference: "REQ-NEW",
      supplier: "Adobe Direct",
      notes: null,
    }));
  });

  it("offers only existing pending orders that already have a supplier", async () => {
    getPendingOrders.mockResolvedValue({
      data: [
        { id: 1, poNumber: "PO-BLANK", supplier: null },
        { id: 2, poNumber: "PO-READY", supplier: "Common Reseller" },
      ],
    });
    renderWithQueryClient(
      <ConvertSourcingModal
        item={{ ...REQUEST, supplier: "Common Reseller" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /add to existing/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /add to existing/i }));
    expect(screen.queryByRole("option", { name: /PO-BLANK/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PO-READY/i })).toBeInTheDocument();
  });
});

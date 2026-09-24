import React from "react";
import { expect, test, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import InvoiceConfirmModal from "../components/licenses/InvoiceConfirmModal.jsx";

function render(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> });
}

function renderModal(onConfirm) {
  render(
    <InvoiceConfirmModal
      data={{
        publisherName: "Acme",
        softwareDescription: "Acme Suite",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        quantity: "10",
        unitPrice: "5",
        currency: "EUR",
        fileName: "manual-entry",
        strategyUsed: "manual",
      }}
      userSettings={{ numberFormatLocale: "en-US" }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
}

const typeSelect = () => screen.getByLabelText(/License Type/i);
const coverageSelect = () => screen.getByLabelText(/^Coverage$/i);
const save = () => fireEvent.click(screen.getByRole("button", { name: /Save License/i }));

test("a new subscription is saved with Included support by default", () => {
  const onConfirm = vi.fn();
  renderModal(onConfirm);

  fireEvent.change(typeSelect(), { target: { value: "subscription" } });
  expect(coverageSelect()).toHaveValue("included");
  save();

  expect(onConfirm.mock.calls[0][0][0]).toEqual(expect.objectContaining({
    licenseType: "subscription",
    maintenanceCoverage: "included",
  }));
});

test("switching type keeps a deliberately chosen coverage", () => {
  renderModal(vi.fn());

  fireEvent.change(typeSelect(), { target: { value: "perpetual" } });
  expect(coverageSelect()).toHaveValue("unknown");
  fireEvent.change(coverageSelect(), { target: { value: "included" } });
  fireEvent.change(typeSelect(), { target: { value: "oem" } });

  expect(coverageSelect()).toHaveValue("included");
});

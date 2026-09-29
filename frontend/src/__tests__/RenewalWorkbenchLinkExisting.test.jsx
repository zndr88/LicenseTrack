import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/renewals.js", async (original) => ({
  ...(await original()),
  getRenewalWorkbench: vi.fn().mockResolvedValue({
    data: [{
      licenseId: 3,
      rowKind: "support_renewal",
      publisherName: "Acme",
      softwareDescription: "Server (included support)",
      renewalStatus: "due_soon",
      daysUntilExpiry: 20,
      endDate: "2026-10-13",
      riskFlags: [],
      customFields: [],
      estimatedAnnualValue: 0,
      currency: "EUR",
    }],
    error: null,
  }),
}));
vi.mock("../api/licenses.js", async (original) => ({
  ...(await original()),
  getLicense: vi.fn().mockResolvedValue({
    data: { id: 3, publisherName: "Acme", softwareDescription: "Server", licenseType: "perpetual", currency: "EUR" },
    error: null,
  }),
  getLicenses: vi.fn().mockResolvedValue({
    data: [
      { id: 3, publisherName: "Acme", softwareDescription: "Server", licenseType: "perpetual", licenseRef: "LT-3" },
      { id: 50, publisherName: "Acme", softwareDescription: "Server support", licenseType: "maintenance", licenseRef: "LT-50", maintenanceParentIds: [] },
    ],
    error: null,
  }),
}));
vi.mock("../hooks/useCustomFieldDefinitions.js", () => ({
  fetchCustomFieldDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../hooks/useRenewalWorkflowActions.js", () => ({
  useRenewalWorkflowActions: () => ({ startRenewal: vi.fn(), startRenewalBundle: vi.fn(), startSupportRenewal: vi.fn() }),
}));
vi.mock("../components/ui/LocalDocumentPreviewPanel.jsx", () => ({ default: () => null }));

import RenewalWorkbenchPage from "../components/pages/RenewalWorkbenchPage.jsx";

describe("Renewal Workbench: Record existing support", () => {
  it("lists existing maintenance records to link", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RenewalWorkbenchPage
          user={{ role: "admin" }}
          userSettings={{ numberFormatLocale: "en-US" }}
          globalSettings={{}}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: /record existing support/i }));
    await user.click(await screen.findByRole("tab", { name: /link existing/i }));
    expect(await screen.findByRole("option", { name: /LT-50/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/No eligible maintenance records/)).toBeNull());
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import SourcingItemModal from "../components/procurement/SourcingItemModal.jsx";
import PendingOrderModal from "../components/procurement/PendingOrderModal.jsx";

// Drift guard: every license-line modal must render the same canonical set of
// sections. If a modal drops or renames one, this fails loudly. (SourcingRequest
// EditModal has its own equivalent assertion in SourcingRequestEditModal.test.jsx.)

const customFieldState = vi.hoisted(() => ({ definitions: [] }));
vi.mock("../hooks/useCustomFieldDefinitions.js", () => ({
  useCustomFieldDefinitions: () => ({ definitions: customFieldState.definitions, loading: false }),
}));

const CANONICAL_SECTIONS = [
  "Identity",
  "Key Dates & Contract",
  "Maintenance / Support",
  "Details",
  "Relationships",
  "Notes",
];

function renderWithClient(ui) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}

function expectCanonicalSections() {
  CANONICAL_SECTIONS.forEach((name) =>
    expect(screen.getByRole("button", { name })).toBeInTheDocument());
}

beforeEach(() => {
  customFieldState.definitions = [];
});

describe("canonical line-modal sections (drift guard)", () => {
  test("SourcingItemModal renders every canonical section", () => {
    renderWithClient(
      <SourcingItemModal
        userSettings={{ numberFormatLocale: "en-US" }}
        item={{ publisherName: "Acme", softwareDescription: "Suite", licenseType: "subscription" }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expectCanonicalSections();
  });

  test("PendingOrderModal renders every canonical section for a maintenance-capable line", () => {
    renderWithClient(
      <PendingOrderModal userSettings={{ numberFormatLocale: "en-US" }} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/license type/i), { target: { value: "subscription" } });
    expectCanonicalSections();
  });
});

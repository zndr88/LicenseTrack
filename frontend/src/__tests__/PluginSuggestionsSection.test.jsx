import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import PluginSuggestionsSection from "../components/licenses/detail/PluginSuggestionsSection.jsx";

const suggestion = {
  id: 7,
  summary: "Review extracted fields",
  pluginKey: "official-parser",
  actionKey: "parse-entitlement",
  confidence: 0.9,
  suggestedFields: [
    { field: "publisherName", value: "Acme Holdings", confidence: 0.8, source: "Page 1", note: "Legal name" },
    { field: "annual_cost", value: "1500", confidence: 0.7 },
  ],
  lineItems: [{ summary: "Support", fields: [{ field: "quantity", value: 3 }] }],
};

const baseProps = {
  license: { id: 1, publisherName: "Acme" },
  perms: { canEdit: true },
  isOpen: true,
  onToggle: vi.fn(),
  suggestions: [suggestion],
  reviewBusy: null,
  onAccept: vi.fn(),
  onReject: vi.fn(),
  cfBySection: {
    commercial: [{ id: 9, fieldKey: "cf_annual_cost", name: "Annual Cost", fieldType: "currency" }],
  },
  customFieldValues: [{ customFieldDefId: 9, valueCurrency: "1200" }],
};

describe("PluginSuggestionsSection", () => {
  test("supports partial acceptance and resets selection for a new suggestion", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const { rerender } = render(<PluginSuggestionsSection {...baseProps} onAccept={onAccept} />);

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByText("Legal name")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("quantity: 3")).toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Accept Selected (1)" }));
    expect(onAccept).toHaveBeenCalledWith(suggestion, [1]);

    const nextSuggestion = { ...suggestion, id: 8, summary: "New extraction" };
    rerender(<PluginSuggestionsSection {...baseProps} onAccept={onAccept} suggestions={[nextSuggestion]} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept Selected (2)" })).toBeEnabled());
  });

  test("keeps rejection and permission gating intact", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    const { rerender } = render(<PluginSuggestionsSection {...baseProps} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Reject All" }));
    expect(onReject).toHaveBeenCalledWith(suggestion);

    rerender(<PluginSuggestionsSection {...baseProps} perms={{ canEdit: false }} onReject={onReject} />);
    expect(screen.queryByRole("button", { name: /Accept Selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject All" })).not.toBeInTheDocument();
  });
});

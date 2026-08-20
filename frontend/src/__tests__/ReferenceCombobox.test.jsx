import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ReferenceCombobox from "../components/ui/ReferenceCombobox.jsx";
import * as referenceDataApi from "../api/referenceData.js";

vi.mock("../api/referenceData.js", () => ({
  cleanReferenceDisplay: (value) => String(value || "").trim().replace(/\s+/g, " "),
  normalizeReferenceSearch: (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase(),
  searchReferenceData: vi.fn(),
}));

function renderCombobox(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [value, setValue] = useState(props.value || "");
    return (
      <ReferenceCombobox
        mode="publisher"
        {...props}
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue);
          props.onChange?.(nextValue);
        }}
      />
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("ReferenceCombobox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("supports keyboard selection with stable ARIA state and create option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    referenceDataApi.searchReferenceData.mockResolvedValue({ data: [], error: null });
    renderCombobox({ onChange });

    const input = screen.getByRole("combobox");
    await user.type(input, "New Vendor");
    await waitFor(() => expect(screen.getByRole("option", { name: /create/i })).toBeInTheDocument());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("New Vendor");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("selects aliases but excludes inactive records from keyboard options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectReference = vi.fn();
    referenceDataApi.searchReferenceData.mockResolvedValue({
      data: [
        { id: 1, name: "Microsoft", isActive: true, aliases: [{ id: 2, name: "MSFT" }] },
        { id: 3, name: "Retired Vendor", isActive: false, aliases: [] },
      ],
      error: null,
    });
    renderCombobox({ onChange, onSelectReference });

    const input = screen.getByRole("combobox");
    await user.type(input, "MSFT");
    await waitFor(() => expect(screen.getByRole("option", { name: /Microsoft/i })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Microsoft/i })).toHaveTextContent("Alias: MSFT");
    expect(screen.getByRole("option", { name: /Retired Vendor/i })).toBeDisabled();
    await user.click(screen.getByRole("option", { name: /Microsoft/i }));

    expect(onChange).toHaveBeenCalledWith("Microsoft");
    expect(onSelectReference).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});

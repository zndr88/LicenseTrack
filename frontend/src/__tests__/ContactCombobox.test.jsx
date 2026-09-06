import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ContactCombobox from "../components/ui/ContactCombobox.jsx";
import * as referenceDataApi from "../api/referenceData.js";

vi.mock("../api/referenceData.js", () => ({
  searchContactReferences: vi.fn(),
}));

function renderCombobox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [value, setValue] = useState("");
    return <ContactCombobox value={value} onChange={setValue} aria-label="Budget owner email" />;
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

function renderMultipleCombobox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [value, setValue] = useState("first@example.com, ");
    return <ContactCombobox multiple value={value} onChange={setValue} aria-label="Secondary contacts" />;
  }
  return render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
}

describe("ContactCombobox", () => {
  beforeEach(() => vi.clearAllMocks());

  test("suggests shared contacts and supports keyboard selection", async () => {
    referenceDataApi.searchContactReferences.mockResolvedValue({
      data: [{ email: "owner@example.com" }, { email: "secondary@example.com" }],
      error: null,
    });
    const user = userEvent.setup();
    renderCombobox();

    const input = screen.getByRole("combobox", { name: "Budget owner email" });
    await user.type(input, "own");
    await waitFor(() => expect(screen.getByRole("option", { name: "owner@example.com" })).toBeInTheDocument());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("owner@example.com");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps unmatched text as free-form input", async () => {
    referenceDataApi.searchContactReferences.mockResolvedValue({ data: [], error: null });
    const user = userEvent.setup();
    renderCombobox();

    const input = screen.getByRole("combobox", { name: "Budget owner email" });
    await user.type(input, "new@example.com");

    expect(input).toHaveValue("new@example.com");
    await waitFor(() => expect(screen.getByText("No matching contact found.")).toBeInTheDocument());
  });

  test("searches and replaces the active token in a comma-separated contact list", async () => {
    referenceDataApi.searchContactReferences.mockResolvedValue({
      data: [{ email: "second@example.com" }],
      error: null,
    });
    const user = userEvent.setup();
    renderMultipleCombobox();

    const input = screen.getByRole("combobox", { name: "Secondary contacts" });
    await user.type(input, "sec");
    await waitFor(() => expect(referenceDataApi.searchContactReferences).toHaveBeenCalledWith("sec"));
    await user.click(screen.getByRole("option", { name: "second@example.com" }));

    expect(input).toHaveValue("first@example.com,second@example.com");
  });
});

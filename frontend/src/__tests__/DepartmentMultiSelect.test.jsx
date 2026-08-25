import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import DepartmentMultiSelect from "../components/users/DepartmentMultiSelect.jsx";

describe("DepartmentMultiSelect", () => {
  test("filters departments with the same searchable behavior as the reports selector", async () => {
    const user = userEvent.setup();
    render(
      <DepartmentMultiSelect
        id="department-access"
        available={[
          { name: "Engineering", isActive: true },
          { name: "Finance", isActive: true },
          { name: "Customer Support", isActive: true },
        ]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No access (no departments selected)" }));

    const listbox = screen.getByRole("listbox");
    const search = within(listbox).getByLabelText("Search departments");
    await waitFor(() => expect(search).toHaveFocus());

    await user.type(search, "FIN");

    expect(within(listbox).getByText("Finance")).toBeInTheDocument();
    expect(within(listbox).queryByText("Engineering")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("Customer Support")).not.toBeInTheDocument();
  });

  test("shows a useful empty state when no department matches", async () => {
    const user = userEvent.setup();
    render(
      <DepartmentMultiSelect
        id="department-access"
        available={[{ name: "Finance", isActive: true }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No access (no departments selected)" }));
    await user.type(screen.getByLabelText("Search departments"), "Legal");

    expect(screen.getByText("No departments match")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MultiSelectFilter from "../components/pages/licenses/MultiSelectFilter.jsx";

const makeOptions = (n) =>
  Array.from({ length: n }, (_, i) => ({ value: `d${i}`, label: `Department ${i}` }));

describe("MultiSelectFilter search", () => {
  it("shows a search box only for long option lists and filters by label", () => {
    render(
      <MultiSelectFilter
        id="cf-costCentre"
        options={makeOptions(12)}
        value={[]}
        onChange={() => {}}
        placeholder="Cost Centre"
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByPlaceholderText("Search...");
    expect(search).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Department 11" } });
    expect(screen.getByText("Department 11")).toBeInTheDocument();
    expect(screen.queryByText("Department 1")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nope" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("omits the search box for short lists", () => {
    render(
      <MultiSelectFilter
        id="cf-licenseType"
        options={makeOptions(4)}
        value={[]}
        onChange={() => {}}
        placeholder="Type"
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  it("still toggles a filtered option", () => {
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        id="cf-costCentre"
        options={makeOptions(12)}
        value={[]}
        onChange={onChange}
        placeholder="Cost Centre"
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "Department 7" } });
    fireEvent.click(screen.getByText("Department 7"));
    expect(onChange).toHaveBeenCalledWith(["d7"]);
  });
});

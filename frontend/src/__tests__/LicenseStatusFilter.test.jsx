import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseStatusFilter from "../components/pages/licenses/LicenseStatusFilter.jsx";
import { DEFAULT_STATUS_FILTERS } from "../constants/licenseData.js";

function setup(overrides = {}) {
  const props = {
    statusFilters: [],
    setStatusFilters: vi.fn(),
    setCurrentPage: vi.fn(),
    ...overrides,
  };
  render(<LicenseStatusFilter {...props} />);
  return props;
}

describe("LicenseStatusFilter", () => {
  test("renders all status chip buttons", () => {
    setup();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("Expiring")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Renewal in progress")).toBeTruthy();
    expect(screen.getByText("Renewed")).toBeTruthy();
    expect(screen.getByText("Retired")).toBeTruthy();
    expect(screen.getByText("Legacy")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("Incomplete")).toBeTruthy();
  });

  test("clicking a chip calls setStatusFilters to add it", () => {
    const { setStatusFilters, setCurrentPage } = setup({ statusFilters: [] });
    fireEvent.click(screen.getByText("Active"));
    expect(setStatusFilters).toHaveBeenCalledOnce();
    // call the updater fn with current state to verify output
    const updater = setStatusFilters.mock.calls[0][0];
    expect(updater([])).toContain("active");
    expect(setCurrentPage).toHaveBeenCalledWith(1);
  });

  test("clicking an active chip removes it", () => {
    const { setStatusFilters } = setup({ statusFilters: ["active"] });
    fireEvent.click(screen.getByText("Active"));
    const updater = setStatusFilters.mock.calls[0][0];
    expect(updater(["active"])).not.toContain("active");
  });

  test("toggling 'complete' removes 'incomplete'", () => {
    const { setStatusFilters } = setup({ statusFilters: ["incomplete"] });
    fireEvent.click(screen.getByText("Complete"));
    const updater = setStatusFilters.mock.calls[0][0];
    const result = updater(["incomplete"]);
    expect(result).toContain("complete");
    expect(result).not.toContain("incomplete");
  });

  test("toggling 'incomplete' removes 'complete'", () => {
    const { setStatusFilters } = setup({ statusFilters: ["complete"] });
    fireEvent.click(screen.getByText("Incomplete"));
    const updater = setStatusFilters.mock.calls[0][0];
    const result = updater(["complete"]);
    expect(result).toContain("incomplete");
    expect(result).not.toContain("complete");
  });

  test("clear button resets to DEFAULT_STATUS_FILTERS", () => {
    const { setStatusFilters, setCurrentPage } = setup({ statusFilters: ["active"] });
    fireEvent.click(screen.getByLabelText("Clear filters"));
    expect(setStatusFilters).toHaveBeenCalledWith(DEFAULT_STATUS_FILTERS);
    expect(setCurrentPage).toHaveBeenCalledWith(1);
  });

  test("clear button is not shown for the default selection", () => {
    setup({ statusFilters: [...DEFAULT_STATUS_FILTERS].reverse() });
    expect(screen.queryByLabelText("Clear filters")).toBeNull();
  });

  test("shows no hidden-matches hint by default", () => {
    setup({ statusFilters: ["active"] });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("hidden-matches hint shows the count and Show all clears the chips", () => {
    const { setStatusFilters, setCurrentPage } = setup({ statusFilters: ["active"], hiddenByStatusCount: 2 });
    expect(screen.getByRole("status").textContent).toContain("2 matches hidden by the status filter");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(setStatusFilters).toHaveBeenCalledWith([]);
    expect(setCurrentPage).toHaveBeenCalledWith(1);
  });

  test("hidden-matches hint uses the singular for one match", () => {
    setup({ statusFilters: ["active"], hiddenByStatusCount: 1 });
    expect(screen.getByRole("status").textContent).toContain("1 match hidden by the status filter");
  });

  test("clear button is shown when no status is selected", () => {
    setup({ statusFilters: [] });
    expect(screen.getByLabelText("Clear filters")).toBeTruthy();
  });

  test("chips report their selected state and carry a colour class", () => {
    setup({ statusFilters: ["active"] });
    const active = screen.getByRole("button", { name: "Active" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.className).toContain("lp-chip-green");
    expect(active.getAttribute("style")).toBeNull();
    expect(screen.getByRole("button", { name: "Expired" }).getAttribute("aria-pressed")).toBe("false");
  });
});

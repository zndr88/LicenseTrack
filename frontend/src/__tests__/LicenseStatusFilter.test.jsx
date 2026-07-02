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
    expect(screen.getByText("Expiring")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
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

  test("clear button is not shown when statusFilters is empty", () => {
    setup({ statusFilters: [] });
    expect(screen.queryByLabelText("Clear filters")).toBeNull();
  });
});

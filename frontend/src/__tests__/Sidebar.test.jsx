import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import Sidebar from "../components/layout/Sidebar.jsx";

describe("Sidebar portfolio overview", () => {
  test("shows the upcoming license count", () => {
    render(
      <Sidebar
        page="licenses"
        setPage={vi.fn()}
        setSelectedId={vi.fn()}
        currentUser={{ role: "admin" }}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        stats={{ active: 4, upcoming: 2, pending: 1, expiring: 3, expired: 0, renewed: 5, retired: 6, legacy: 7, renewalInProgress: 8, retirementScheduled: 9 }}
      />
    );

    const upcomingRow = screen.getByText("Upcoming").closest(".sb-portfolio-row");
    expect(within(upcomingRow).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("PORTFOLIO OVERVIEW")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pending Orders, 1 pending" })).toBeInTheDocument();
    for (const [label, count] of [
      ["Active · not expiring", "4"],
      ["Renewal in progress", "8"],
      ["Retirement scheduled", "9"],
      ["Renewed", "5"],
      ["Retired", "6"],
      ["Legacy", "7"],
    ]) {
      expect(within(screen.getByText(label).closest(".sb-portfolio-row")).getByText(count)).toBeInTheDocument();
    }
  });
});

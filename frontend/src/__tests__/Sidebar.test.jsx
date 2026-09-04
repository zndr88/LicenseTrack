import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import Sidebar from "../components/layout/Sidebar.jsx";

describe("Sidebar portfolio condition", () => {
  test("shows the upcoming license count", () => {
    render(
      <Sidebar
        page="licenses"
        setPage={vi.fn()}
        setSelectedId={vi.fn()}
        currentUser={{ role: "admin" }}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        stats={{ active: 4, upcoming: 2, pending: 1, expiring: 3, expired: 0, renewed: 5 }}
      />
    );

    const upcomingRow = screen.getByText("Upcoming").closest(".sb-portfolio-row");
    expect(within(upcomingRow).getByText("2")).toBeInTheDocument();
  });
});

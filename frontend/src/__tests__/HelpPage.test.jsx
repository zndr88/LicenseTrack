import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import HelpPage from "../components/pages/HelpPage.jsx";

describe("HelpPage", () => {
  test("includes the major feature and administration topics", () => {
    render(<HelpPage />);

    expect(screen.getByText("Contracts")).toBeInTheDocument();
    expect(screen.getByText("Notifications and email")).toBeInTheDocument();
    expect(screen.getByText("Audit log")).toBeInTheDocument();
  });

  test("searches across article details", () => {
    render(<HelpPage />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search help" }), {
      target: { value: "centralized application" },
    });

    expect(screen.getByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.queryByText("Contracts")).not.toBeInTheDocument();
  });
});

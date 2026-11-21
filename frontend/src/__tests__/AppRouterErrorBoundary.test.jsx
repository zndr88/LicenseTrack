import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import AppRouter from "../AppRouter.jsx";

const pageFailure = vi.hoisted(() => ({ reports: null }));

vi.mock("../components/pages/LicensesPage.jsx", () => ({ default: () => <div>Licenses page</div> }));
vi.mock("../components/pages/ReportsPage.jsx", () => ({
  default: () => {
    if (pageFailure.reports) throw pageFailure.reports;
    return <div>Reports page</div>;
  },
}));
vi.mock("../components/pages/HelpPage.jsx", () => ({ default: () => <div>Help page</div> }));

const baseProps = {
  setPage: vi.fn(),
  perms: { canUpload: true, canAdminSettings: true },
  currentUser: { id: 1, role: "admin" },
  userSettings: {},
  globalSettings: {},
  confirmData: null,
};

function Shell({ page }) {
  return (
    <>
      <nav aria-label="Main navigation">Sidebar</nav>
      <AppRouter {...baseProps} page={page} />
    </>
  );
}

function renderShell(page) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (currentPage) => (
    <QueryClientProvider client={queryClient}>
      <Shell page={currentPage} />
    </QueryClientProvider>
  );
  const view = render(wrap(page));
  return { ...view, goTo: (nextPage) => view.rerender(wrap(nextPage)) };
}

describe("AppRouter page error boundary", () => {
  let consoleSpy;
  const suppressExpectedError = (event) => {
    if (event.error === pageFailure.reports) event.preventDefault();
  };

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", suppressExpectedError);
  });

  afterEach(() => {
    window.removeEventListener("error", suppressExpectedError);
    consoleSpy.mockRestore();
    pageFailure.reports = null;
  });

  test("a page that throws leaves the navigation and the other pages working", async () => {
    pageFailure.reports = new Error("Reports exploded");
    const { goTo } = renderShell("reports");

    expect(await screen.findByRole("heading", { name: "This page could not be displayed" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    goTo("help");
    expect(await screen.findByText("Help page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    goTo("licenses");
    expect(screen.getByText("Licenses page")).toBeInTheDocument();
  });

  test("Try again shows the page once the error is gone", async () => {
    pageFailure.reports = new Error("Reports exploded");
    renderShell("reports");

    const retry = await screen.findByRole("button", { name: "Try again" });
    pageFailure.reports = null;
    fireEvent.click(retry);

    expect(await screen.findByText("Reports page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a page that can no longer be fetched offers a reload for the new version", async () => {
    pageFailure.reports = new TypeError(
      "Failed to fetch dynamically imported module: http://localhost/assets/ReportsPage-abc123.js",
    );
    const { goTo } = renderShell("reports");

    expect(await screen.findByRole("heading", { name: "A new version is available" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();

    goTo("help");
    expect(await screen.findByText("Help page")).toBeInTheDocument();
  });
});

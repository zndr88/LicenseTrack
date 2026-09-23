import React, { useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberPathForLogin, useUrlSync } from "../hooks/useUrlSync.js";
import { queryKeys } from "../queryKeys.js";

vi.mock("../components/pages/licenses/useLicensesPageData.js", () => ({
  fetchLicensesData: vi.fn().mockResolvedValue({ licenses: [] }),
}));

let api;

function Harness({ guard = () => true, initialPage = "licenses" }) {
  const [page, setPage] = useState(initialPage);
  const [selectedId, setSelectedId] = useState(null);
  const navigateToPage = React.useCallback((next) => { if (guard(next)) setPage(next); }, [guard]);
  api = { page, selectedId, setPage, setSelectedId };
  useUrlSync({ enabled: true, page, navigateToPage, selectedId, selectLicense: setSelectedId });
  return null;
}

function renderHarness(props, licenses = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.licenses, { licenses });
  return render(<QueryClientProvider client={queryClient}><Harness {...props} /></QueryClientProvider>);
}

function goBackTo(path) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useUrlSync", () => {
  it("opens the page and license named in the URL", async () => {
    window.history.replaceState(null, "", "/licenses/LT-7");
    renderHarness({}, [{ id: 7, licenseRef: "LT-7" }]);

    await waitFor(() => expect(api.selectedId).toBe(7));
    expect(window.location.pathname).toBe("/licenses/7");
  });

  it("pushes page and selection changes to the URL", async () => {
    renderHarness();
    await waitFor(() => expect(window.location.pathname).toBe("/licenses"));

    act(() => api.setPage("reports"));
    expect(window.location.pathname).toBe("/reports");

    act(() => api.setPage("licenses"));
    act(() => api.setSelectedId(12));
    expect(window.location.pathname).toBe("/licenses/12");
  });

  it("restores the page on Back", async () => {
    renderHarness();
    act(() => api.setPage("reports"));

    act(() => goBackTo("/sourcing"));

    await waitFor(() => expect(api.page).toBe("sourcing"));
    expect(window.location.pathname).toBe("/sourcing");
  });

  it("keeps the URL on the current page when a guard blocks Back", async () => {
    renderHarness({ guard: (next) => next !== "reports" });
    act(() => api.setPage("admin"));

    act(() => goBackTo("/reports"));

    await waitFor(() => expect(window.location.pathname).toBe("/admin"));
    expect(api.page).toBe("admin");
  });

  it("ignores Back while a dialog is open", async () => {
    renderHarness();
    act(() => api.setPage("reports"));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    act(() => goBackTo("/sourcing"));

    expect(api.page).toBe("reports");
    expect(window.location.pathname).toBe("/reports");
  });

  it("returns to the requested page after an SSO round trip", async () => {
    window.history.replaceState(null, "", "/renewals");
    rememberPathForLogin();
    window.history.replaceState(null, "", "/");

    renderHarness();

    await waitFor(() => expect(api.page).toBe("renewal-workbench"));
    expect(window.location.pathname).toBe("/renewals");
  });

  it("rewrites unknown paths to Licenses", async () => {
    window.history.replaceState(null, "", "/does-not-exist");
    renderHarness();

    await waitFor(() => expect(window.location.pathname).toBe("/licenses"));
  });
});

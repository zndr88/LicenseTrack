import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import CSVImportPage from "../components/pages/CSVImportPage.jsx";
import * as csvImportApi from "../api/csvImport.js";

vi.mock("../api/licenses.js", () => ({
  getLicenses: vi.fn().mockResolvedValue({ data: [], error: null }),
}));
vi.mock("../api/csvImport.js", () => ({
  previewCsvImport: vi.fn(),
  confirmCsvImport: vi.fn(),
  downloadCsvTemplate: vi.fn(),
  analyzeImport: vi.fn(),
  executeImport: vi.fn(),
  previewMappedImport: vi.fn(),
  listImportMappings: vi.fn(),
  deleteImportMapping: vi.fn(),
  putImportMapping: vi.fn(),
}));

const previewResponse = {
  data: {
    totalRows: 1,
    activeCount: 1,
    legacyExemptCount: 0,
    legacyIncompleteCount: 0,
    errorCount: 0,
    validRows: 1,
    headersMissing: [],
    rows: [{
      rowNumber: 1,
      publisherName: "Acme",
      softwareDescription: "Imported Suite",
      importStatus: "active",
      validationErrors: [],
      warnings: [],
      duplicateWarnings: [],
    }],
  },
  error: null,
};

// Stands in for the app shell: keeps the guard the page registers and lets a
// test try to open another page, as the sidebar and top bar do.
function renderImportPage() {
  const navigate = vi.fn();
  let guard = null;
  const navGuard = { navigate, registerNavGuard: (fn) => { guard = fn; } };
  const view = render(<CSVImportPage onImportComplete={vi.fn()} navGuard={navGuard} />);
  const openPage = (page) => act(() => {
    if (guard) guard(page);
    else navigate(page);
  });
  return { ...view, navigate, openPage, hasGuard: () => guard != null };
}

// The page switches the warning on and off in an effect, so tests wait for it
// with waitFor after a state change instead of reading it straight away.
function closingTabAsksFirst() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function loadFile(container) {
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [new File(["publisher"], "licenses.csv", { type: "text/csv" })] },
  });
  expect(await screen.findByText("Imported Suite")).toBeInTheDocument();
  // The preview can be on screen a moment before the page has switched its
  // leave guard on, so wait for the guard before a test tries to leave.
  await waitFor(() => expect(closingTabAsksFirst()).toBe(true));
}

describe("CSV import leave warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    csvImportApi.listImportMappings.mockResolvedValue({ data: [], error: null });
    csvImportApi.previewCsvImport.mockResolvedValue(previewResponse);
    csvImportApi.confirmCsvImport.mockResolvedValue({
      data: { importedCount: 1, skippedCount: 0, errors: [] },
      error: null,
    });
  });

  test("does not warn before a file is chosen", () => {
    const { navigate, openPage } = renderImportPage();

    openPage("licenses");

    expect(navigate).toHaveBeenCalledWith("licenses");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(closingTabAsksFirst()).toBe(false);
  });

  test("asks before leaving once a file is loaded, and stays on Stay", async () => {
    const { container, navigate, openPage } = renderImportPage();
    await loadFile(container);

    expect(closingTabAsksFirst()).toBe(true);
    openPage("licenses");

    expect(screen.getByRole("dialog", { name: "Leave the import?" })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Imported Suite")).toBeInTheDocument();
  });

  test("leaves for the chosen page on Leave", async () => {
    const { container, navigate, openPage } = renderImportPage();
    await loadFile(container);

    openPage("reports");
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(navigate).toHaveBeenCalledWith("reports");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("choosing Import again while importing does not ask", async () => {
    const { container, navigate, openPage } = renderImportPage();
    await loadFile(container);

    openPage("import");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("does not warn after cancelling back to the upload step", async () => {
    const { container, navigate, openPage } = renderImportPage();
    await loadFile(container);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(closingTabAsksFirst()).toBe(false));
    openPage("licenses");

    expect(navigate).toHaveBeenCalledWith("licenses");
  });

  test("does not warn on the Done step", async () => {
    const { container, navigate, openPage } = renderImportPage();
    await loadFile(container);

    fireEvent.click(screen.getByRole("button", { name: /Import 1 license/i }));
    expect(await screen.findByText(/Import complete/i)).toBeInTheDocument();

    await waitFor(() => expect(closingTabAsksFirst()).toBe(false));
    openPage("licenses");

    expect(navigate).toHaveBeenCalledWith("licenses");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("removes its guard when the page closes", async () => {
    const { container, unmount, hasGuard } = renderImportPage();
    await loadFile(container);
    expect(hasGuard()).toBe(true);

    unmount();

    expect(hasGuard()).toBe(false);
    expect(closingTabAsksFirst()).toBe(false);
  });
});

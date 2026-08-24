import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import LicenseToolbar from "../components/pages/licenses/LicenseToolbar.jsx";
import { COLUMN_DEFS } from "../components/pages/licenses/licenseColumns.js";

const baseUserSettings = {
  savedViews: [],
  numberFormatLocale: "en-US",
};

function setup(overrides = {}) {
  const props = {
    search: "",
    setSearch: vi.fn(),
    setCurrentPage: vi.fn(),
    filterRowOpen: false,
    setFilterRowOpen: vi.fn(),
    hasColumnFilters: false,
    setColumnFilters: vi.fn(),
    statsVisible: true,
    onSetStatsVisible: vi.fn(),
    fullViewProp: false,
    handleToggleFullView: vi.fn(),
    loadLicenses: vi.fn(),
    selectedIds: new Set(),
    setShowBulkDeleteConfirm: vi.fn(),
    userSettings: baseUserSettings,
    handleSaveView: vi.fn(),
    handleDeleteView: vi.fn(),
    handleSetDefaultView: vi.fn(),
    handleLoadView: vi.fn(),
    handleRevertToDefault: vi.fn(),
    handleSetVisibleColumn: vi.fn(),
    handleSetVisibleColumnGroup: vi.fn(),
    activeColumns: [],
    visList: {},
    filtered: [],
    displayCurrency: "USD",
    licenses: [],
    customFieldValuesMap: new Map(),
    showError: vi.fn(),
    ...overrides,
  };
  render(<LicenseToolbar {...props} />);
  return props;
}

describe("LicenseToolbar", () => {
  test("renders search input", () => {
    setup();
    expect(screen.getByPlaceholderText("Search...")).toBeTruthy();
  });

  test("search input calls setSearch and setCurrentPage", () => {
    const { setSearch, setCurrentPage } = setup();
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "acme" } });
    expect(setSearch).toHaveBeenCalledWith("acme");
    expect(setCurrentPage).toHaveBeenCalledWith(1);
  });

  test("saved views dropdown opens on bookmark button click", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Saved views"));
    expect(screen.getByPlaceholderText("View name...")).toBeTruthy();
  });

  test("saving a new view name calls handleSaveView with trimmed name", () => {
    const { handleSaveView } = setup();
    fireEvent.click(screen.getByLabelText("Saved views"));
    fireEvent.change(screen.getByPlaceholderText("View name..."), { target: { value: "  My View  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(handleSaveView).toHaveBeenCalledWith("My View");
  });

  test("saving a duplicate name shows overwrite confirmation instead of saving", () => {
    const { handleSaveView } = setup({
      userSettings: { savedViews: [{ name: "Existing" }], numberFormatLocale: "en-US" },
    });
    fireEvent.click(screen.getByLabelText("Saved views"));
    fireEvent.change(screen.getByPlaceholderText("View name..."), { target: { value: "Existing" } });
    fireEvent.click(screen.getByText("Save"));
    // handleSaveView should NOT have been called yet — overwrite prompt shown instead
    expect(handleSaveView).not.toHaveBeenCalled();
    // The overwrite confirmation renders a paragraph and a button both containing "Overwrite"
    expect(screen.getAllByText(/Overwrite/).length).toBeGreaterThan(0);
  });

  test("confirming overwrite calls handleSaveView with the duplicate name", () => {
    const { handleSaveView } = setup({
      userSettings: { savedViews: [{ name: "Existing" }], numberFormatLocale: "en-US" },
    });
    fireEvent.click(screen.getByLabelText("Saved views"));
    fireEvent.change(screen.getByPlaceholderText("View name..."), { target: { value: "Existing" } });
    fireEvent.click(screen.getByText("Save"));
    // Click the "Overwrite" confirm button (there may be multiple elements with "Overwrite" text — get the button)
    const overwriteBtn = screen.getAllByText("Overwrite").find(el => el.tagName === "BUTTON");
    fireEvent.click(overwriteBtn);
    expect(handleSaveView).toHaveBeenCalledWith("Existing");
  });

  test("saved view default action toggles the selected saved view", () => {
    const { handleSetDefaultView } = setup({
      userSettings: {
        savedViews: [
          { name: "Operations", isDefault: true },
          { name: "Renewals" },
        ],
        numberFormatLocale: "en-US",
      },
    });

    fireEvent.click(screen.getByLabelText("Saved views"));

    expect(screen.getByText("Default")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Set Renewals as my default view"));

    expect(handleSetDefaultView).toHaveBeenCalledWith("Renewals");
  });

  test("Save button is disabled when view name input is empty", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Saved views"));
    const saveBtn = screen.getByText("Save").closest("button");
    expect(saveBtn.disabled).toBe(true);
  });

  test("bulk delete button shown when selectedIds is non-empty", () => {
    setup({ selectedIds: new Set([1, 2]) });
    expect(screen.getByLabelText("Delete 2 selected license(s)")).toBeTruthy();
  });

  test("bulk delete button not shown when selectedIds is empty", () => {
    setup({ selectedIds: new Set() });
    expect(screen.queryByLabelText(/Delete \d+ selected/)).toBeNull();
  });

  test("CSV export options are disclosed from a single toolbar button", () => {
    setup();
    expect(screen.queryByLabelText("Toggle localized CSV export")).toBeNull();

    fireEvent.click(screen.getByLabelText("Export CSV"));

    expect(screen.getByRole("menu", { name: "CSV export options" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Export Current View\s*Filtered rows and visible columns/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Export Full Data\s*Filtered rows and every available column/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Export Current View \(localized\)\s*Use your date and number formats/ })).toBeTruthy();
  });

  test("CSV export options close when clicking outside the menu", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Export CSV"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "CSV export options" })).toBeNull();
  });

  test("column category menu toggles individual visible columns", () => {
    const { handleSetVisibleColumn } = setup({
      activeColumns: [
        { key: "publisher", label: "Publisher", group: "standard" },
        { key: "createdBy", label: "Created By", group: "advanced" },
      ],
      visList: { publisher: true, createdBy: false },
    });

    fireEvent.click(screen.getByLabelText("Column categories"));
    fireEvent.click(screen.getByRole("switch", { name: "Show Publisher column" }));

    expect(handleSetVisibleColumn).toHaveBeenCalledWith("publisher", false);
  });

  test("column category menu exposes the Docs column", () => {
    const { handleSetVisibleColumn } = setup({
      activeColumns: COLUMN_DEFS,
      visList: { docs: true },
    });

    fireEvent.click(screen.getByLabelText("Column categories"));
    fireEvent.click(screen.getByRole("switch", { name: "Show Docs column" }));

    expect(handleSetVisibleColumn).toHaveBeenCalledWith("docs", false);
  });

  test("column category menu fits the viewport below a lowered toolbar", () => {
    setup({ activeColumns: COLUMN_DEFS, visList: {} });
    const button = screen.getByLabelText("Column categories");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      right: 900,
    });
    vi.stubGlobal("innerHeight", 700);
    vi.stubGlobal("innerWidth", 1000);

    fireEvent.click(button);

    const menu = screen.getByRole("menu", { name: "Column categories" });
    expect(menu.style.top).toBe("504px");
    expect(menu.style.maxHeight).toBe("184px");
    vi.unstubAllGlobals();
  });

  test("column category menu toggles grouped visible columns", () => {
    const { handleSetVisibleColumnGroup } = setup({
      activeColumns: [
        { key: "publisher", label: "Publisher", group: "standard" },
        { key: "description", label: "Description", group: "standard" },
        { key: "createdBy", label: "Created By", group: "advanced" },
      ],
      visList: { publisher: true, description: false, createdBy: false },
    });

    fireEvent.click(screen.getByLabelText("Column categories"));
    fireEvent.click(screen.getByRole("switch", { name: "Toggle all Standard columns" }));

    expect(handleSetVisibleColumnGroup).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "publisher" }),
        expect.objectContaining({ key: "description" }),
      ]),
      true
    );
  });
});

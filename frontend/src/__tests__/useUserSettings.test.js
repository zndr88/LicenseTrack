import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useUserSettings } from "../hooks/useUserSettings.js";
import { updateSettings } from "../api/settings.js";

vi.mock("../api/settings.js", () => ({
  updateSettings: vi.fn(),
}));

const baseUserSettings = {
  savedViews: [],
  displayCurrency: "EUR",
  numberFormatLocale: "en-US",
  columnOrder: ["publisher", "licenseType"],
  visibleInList: { publisher: true, licenseType: true },
  visibleInDetail: {},
  theme: "light",
  sidebarCollapsed: false,
};

function setup(overrides = {}) {
  const props = {
    userSettings: baseUserSettings,
    setUserSettings: vi.fn(),
    statusFilters: ["active"],
    setStatusFilters: vi.fn(),
    columnFilters: { publisher: "acme", licenseType: ["subscription"] },
    setColumnFilters: vi.fn(),
    sortCol: "publisher",
    sortDir: "desc",
    setSortCol: vi.fn(),
    setSortDir: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    ...overrides,
  };
  const rendered = renderHook(() => useUserSettings(props));
  return { ...rendered, props };
}

describe("useUserSettings saved views", () => {
  beforeEach(() => {
    updateSettings.mockClear();
    updateSettings.mockResolvedValue({ data: {}, error: null });
  });

  test("handleSaveView stores active column filters in the saved view", async () => {
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleSaveView("Filtered Licenses");
    });

    const savedViews = updateSettings.mock.calls[0][0].saved_views;
    expect(savedViews).toEqual([
      {
        name: "Filtered Licenses",
        statusFilters: ["active"],
        columnFilters: { publisher: "acme", licenseType: ["subscription"] },
        columnOrder: ["publisher", "licenseType"],
        visibleInList: { publisher: true, licenseType: true },
        sortCol: "publisher",
        sortDir: "desc",
      },
    ]);
    expect(props.showSuccess).toHaveBeenCalledWith("View saved.");
  });

  test("handleLoadView restores saved column filters", async () => {
    const { result, props } = setup();
    const view = {
      name: "Publisher Filter",
      statusFilters: ["expired"],
      columnFilters: { publisher: "contoso", licenseType: ["perpetual"] },
      columnOrder: ["licenseType", "publisher"],
      visibleInList: { publisher: true, licenseType: false },
      sortCol: "licenseType",
      sortDir: "asc",
    };

    await act(async () => {
      await result.current.handleLoadView(view);
    });

    expect(props.setStatusFilters).toHaveBeenCalledWith(["expired"]);
    expect(props.setColumnFilters).toHaveBeenCalledWith({
      publisher: "contoso",
      licenseType: ["perpetual"],
    });
    expect(props.setSortCol).toHaveBeenCalledWith("licenseType");
    expect(props.setSortDir).toHaveBeenCalledWith("asc");
  });

  test("handleLoadView clears column filters for older views without them", async () => {
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleLoadView({ name: "Old View" });
    });

    expect(props.setColumnFilters).toHaveBeenCalledWith({});
  });

  test("handleSaveView preserves the default marker when overwriting a default view", async () => {
    const { result } = setup({
      userSettings: {
        ...baseUserSettings,
        savedViews: [{ name: "Preferred", isDefault: true }],
      },
    });

    await act(async () => {
      await result.current.handleSaveView("Preferred");
    });

    expect(updateSettings.mock.calls[0][0].saved_views[0]).toMatchObject({
      name: "Preferred",
      isDefault: true,
    });
  });

  test("handleSetDefaultView marks only the selected saved view as default", async () => {
    const { result } = setup({
      userSettings: {
        ...baseUserSettings,
        savedViews: [
          { name: "Operations", isDefault: true },
          { name: "Renewals" },
        ],
      },
    });

    await act(async () => {
      await result.current.handleSetDefaultView("Renewals");
    });

    expect(updateSettings.mock.calls[0][0].saved_views).toEqual([
      { name: "Operations" },
      { name: "Renewals", isDefault: true },
    ]);
  });

  test("handleSetDefaultView clears the default marker when selecting the current default", async () => {
    const { result } = setup({
      userSettings: {
        ...baseUserSettings,
        savedViews: [{ name: "Operations", isDefault: true }],
      },
    });

    await act(async () => {
      await result.current.handleSetDefaultView("Operations");
    });

    expect(updateSettings.mock.calls[0][0].saved_views).toEqual([
      { name: "Operations" },
    ]);
  });

  test("handleHideColumn rolls back local settings when save fails", async () => {
    updateSettings.mockResolvedValueOnce({ data: null, error: "Save failed" });
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleHideColumn("publisher");
    });

    expect(props.showError).toHaveBeenCalledWith("Save failed");
    expect(props.setUserSettings).toHaveBeenLastCalledWith(baseUserSettings);
  });

  test("handleSetVisibleColumn persists a list column visibility change", async () => {
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleSetVisibleColumn("publisher", false);
    });

    expect(updateSettings.mock.calls[0][0].visible_in_list).toEqual({
      publisher: false,
      licenseType: true,
    });
    expect(props.setUserSettings).toHaveBeenCalled();
  });

  test("handleSetVisibleColumnGroup persists grouped list column visibility changes", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleSetVisibleColumnGroup([
        { key: "publisher" },
        { key: "startDate", settingsKey: "dates" },
      ], true);
    });

    expect(updateSettings.mock.calls[0][0].visible_in_list).toEqual({
      publisher: true,
      licenseType: true,
      dates: true,
    });
  });

  test("handleSetVisibleColumn rolls back local settings when save fails", async () => {
    updateSettings.mockResolvedValueOnce({ data: null, error: "Save failed" });
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleSetVisibleColumn("publisher", false);
    });

    expect(props.showError).toHaveBeenCalledWith("Save failed");
    expect(props.setUserSettings).toHaveBeenLastCalledWith(baseUserSettings);
  });

  test("handleLoadView rolls back local view state when save fails", async () => {
    updateSettings.mockResolvedValueOnce({ data: null, error: "Save failed" });
    const { result, props } = setup();

    await act(async () => {
      await result.current.handleLoadView({
        name: "Broken View",
        statusFilters: ["expired"],
        columnFilters: { publisher: "contoso" },
        columnOrder: ["licenseType"],
        visibleInList: { publisher: false },
        sortCol: "licenseType",
        sortDir: "asc",
      });
    });

    expect(props.setStatusFilters).toHaveBeenLastCalledWith(["active"]);
    expect(props.setColumnFilters).toHaveBeenLastCalledWith({ publisher: "acme", licenseType: ["subscription"] });
    expect(props.setSortCol).toHaveBeenLastCalledWith("publisher");
    expect(props.setSortDir).toHaveBeenLastCalledWith("desc");
    expect(props.setUserSettings).toHaveBeenLastCalledWith(baseUserSettings);
  });
});

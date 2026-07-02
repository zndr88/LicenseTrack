import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../api/settings.js", () => ({
  listCustomFields: vi.fn().mockResolvedValue({
    data: [{ id: 1, fieldKey: "owner", name: "Owner" }],
    error: null,
  }),
  updateSettings: vi.fn(),
}));

import VisibleCategoriesSection from "../components/settings/sections/VisibleCategoriesSection.jsx";

const userSettings = {
  visibleInList: {},
  visibleInDetail: {},
  savedViews: [],
  columnOrder: [],
};

function setup() {
  const setUserSettings = vi.fn();
  render(
    <VisibleCategoriesSection
      isOpen
      isDirty={false}
      onToggle={vi.fn()}
      markDirty={vi.fn()}
      clearDirty={vi.fn()}
      userSettings={userSettings}
      setUserSettings={setUserSettings}
      onError={vi.fn()}
      onToast={vi.fn()}
    />
  );
  return setUserSettings;
}

describe("VisibleCategoriesSection toggle-all controls", () => {
  test("enables every advanced list field together", () => {
    const setUserSettings = setup();

    fireEvent.click(screen.getByRole("switch", { name: "Toggle all Advanced list fields" }));

    const next = setUserSettings.mock.calls[0][0](userSettings);
    expect(next.visibleInList).toEqual(expect.objectContaining({
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      lifecycleStatus: true,
      syncStatus: true,
      lastSyncedAt: true,
      maintenanceStartDate: true,
      maintenanceEndDate: true,
      maintenanceCost: true,
    }));
  });

  test("enables every custom list field together", async () => {
    const setUserSettings = setup();

    const toggle = await screen.findByRole("switch", { name: "Toggle all Custom Fields list fields" });
    fireEvent.click(toggle);

    await waitFor(() => expect(setUserSettings).toHaveBeenCalled());
    const next = setUserSettings.mock.calls[0][0](userSettings);
    expect(next.visibleInList.cf_owner).toBe(true);
  });
});

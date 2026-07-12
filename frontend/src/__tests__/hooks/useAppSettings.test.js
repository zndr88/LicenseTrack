import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../api/settings.js", () => ({
  getGlobalSettings: vi.fn(),
  getGlobalSettingsPublic: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import { updateSettings } from "../../api/settings.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";

describe("useAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rolls back sidebar collapse when persistence fails", async () => {
    updateSettings.mockResolvedValueOnce({ data: null, error: "Save failed" });
    const showError = vi.fn();
    const { result } = renderHook(() => useAppSettings({ showError }));

    await act(async () => {
      await result.current.handleToggleSidebar();
    });

    await waitFor(() => {
      expect(result.current.userSettings.sidebarCollapsed).toBe(false);
    });
    expect(showError).toHaveBeenCalledWith("Save failed");
  });
});

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../api/settings.js", () => ({
  updateSettings: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));

import { updateSettings } from "../api/settings.js";
import AppearanceSection from "../components/settings/sections/AppearanceSection.jsx";
import Sidebar from "../components/layout/Sidebar.jsx";

const baseSettings = {
  theme: "light", uiSize: "normal", displayCurrency: "EUR", numberFormatLocale: "en-US",
  dateFormat: "DD/MM/YYYY", timeFormat: "24h", timeZone: "UTC", visibleInList: {}, visibleInDetail: {},
  columnOrder: [], savedViews: [], sidebarCollapsed: false, showPortfolioOverview: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Harness({ initial = baseSettings }) {
  const [settings, setSettings] = useState(initial);
  const [dirty, setDirty] = useState(false);
  return (
    <AppearanceSection
      isOpen
      isDirty={dirty}
      onToggle={vi.fn()}
      markDirty={() => setDirty(true)}
      clearDirty={() => setDirty(false)}
      userSettings={settings}
      setUserSettings={setSettings}
      onError={vi.fn()}
      onToast={vi.fn()}
      navGuard={null}
    />
  );
}

describe("Portfolio overview toggle", () => {
  test("Appearance saves show_portfolio_overview when the box is unticked", async () => {
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: /show portfolio overview in the sidebar/i });
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ show_portfolio_overview: false }),
    ));
  });

  test("the Sidebar shows the portfolio overview by default and hides it when turned off", () => {
    const props = { page: "licenses", setPage: vi.fn(), setSelectedId: vi.fn(), currentUser: { role: "admin" }, collapsed: false, onToggleCollapse: vi.fn() };
    const { rerender } = render(<Sidebar {...props} />);
    expect(screen.getByText("PORTFOLIO OVERVIEW")).toBeInTheDocument();
    rerender(<Sidebar {...props} showPortfolioOverview={false} />);
    expect(screen.queryByText("PORTFOLIO OVERVIEW")).not.toBeInTheDocument();
  });
});

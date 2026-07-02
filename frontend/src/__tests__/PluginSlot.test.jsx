import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import PluginSlot from "../components/plugins/PluginSlot.jsx";
import { invokePluginAction, listPluginActions } from "../api/pluginActions.js";

vi.mock("../api/pluginActions.js", () => ({
  listPluginActions: vi.fn(),
  invokePluginAction: vi.fn(),
}));

describe("PluginSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPluginActions.mockResolvedValue({
      data: {
        actions: [
          {
            key: "plugin-ai:parseDocument",
            pluginKey: "plugin-ai",
            pluginName: "Plugin AI",
            actionKey: "parseDocument",
            label: "Parse Document",
            description: "Parse this document.",
          },
        ],
      },
      error: null,
    });
  });

  test("loads and invokes plugin actions for a slot target", async () => {
    const user = userEvent.setup();
    invokePluginAction.mockResolvedValue({
      data: { status: "ok", summary: "Parsed by plugin" },
      error: null,
    });

    render(
      <PluginSlot
        slot="document.row.actions"
        context={{ targetType: "license_document", targetId: 42 }}
      />,
    );

    expect(await screen.findByRole("button", { name: /parse document/i })).toBeInTheDocument();
    expect(listPluginActions).toHaveBeenCalledWith({
      slot: "document.row.actions",
      targetType: "license_document",
      targetId: 42,
    });

    await user.click(screen.getByRole("button", { name: /parse document/i }));

    await waitFor(() => expect(invokePluginAction).toHaveBeenCalledWith(
      "plugin-ai",
      "parseDocument",
      {
        targetType: "license_document",
        targetId: "42",
        context: { targetType: "license_document", targetId: 42 },
      },
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("Parsed by plugin");
  });

  test("announces created suggestions and emits a refresh event", async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener("plugin-suggestions:changed", listener);
    invokePluginAction.mockResolvedValue({
      data: { status: "ok", suggestionsCreated: 2 },
      error: null,
    });

    render(
      <PluginSlot
        slot="document.row.actions"
        context={{ targetType: "license_document", targetId: 42, licenseId: 9 }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /parse document/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("2 suggestions created.");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ licenseId: 9, suggestionsCreated: 2 });
    window.removeEventListener("plugin-suggestions:changed", listener);
  });

  test("renders nothing and logs a warning when listPluginActions returns an error", async () => {
    listPluginActions.mockResolvedValue({ data: null, error: "Network error" });
    const { container } = render(
      <PluginSlot
        slot="document.row.actions"
        context={{ targetType: "license_document", targetId: 42 }}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  test("shows plugin invocation errors inline", async () => {
    const user = userEvent.setup();
    invokePluginAction.mockResolvedValue({ data: null, error: "Runtime failed" });

    render(
      <PluginSlot
        slot="document.row.actions"
        context={{ targetType: "license_document", targetId: 42 }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /parse document/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Parse Document failed: Runtime failed");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import WebhooksSection from "../components/settings/sections/WebhooksSection.jsx";
import { listWebhooks, updateWebhook } from "../api/settings.js";

vi.mock("../api/settings.js", () => ({
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  listWebhooks: vi.fn(),
  retryWebhookDelivery: vi.fn(),
  testWebhook: vi.fn(),
  updateWebhook: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: () => null,
}));

const props = {
  isOpen: true,
  isDirty: false,
  onToggle: vi.fn(),
  onError: vi.fn(),
  onToast: vi.fn(),
  userSettings: {},
};

describe("WebhooksSection event selection", () => {
  beforeEach(() => {
    listWebhooks.mockReset();
    updateWebhook.mockReset();
  });

  test("applies all-event and non-empty fallback rules in create mode", async () => {
    const user = userEvent.setup();
    listWebhooks.mockResolvedValue({ data: [], error: null });
    render(<WebhooksSection {...props} />);

    await screen.findByText("No webhook endpoints yet.");
    await user.click(screen.getByRole("button", { name: "Create Webhook" }));
    const allEvents = screen.getByLabelText("All events");
    const licenseCreated = screen.getByLabelText("License created");

    expect(licenseCreated).toBeChecked();
    await user.click(allEvents);
    expect(allEvents).toBeChecked();
    expect(licenseCreated).not.toBeChecked();

    await user.click(allEvents);
    expect(allEvents).not.toBeChecked();
    expect(licenseCreated).toBeChecked();
  });

  test("uses the same selection rule while editing", async () => {
    const user = userEvent.setup();
    const endpoint = {
      id: 4,
      name: "CMDB",
      url: "https://example.com/hook",
      events: ["*"],
      is_active: true,
    };
    listWebhooks.mockResolvedValue({ data: [endpoint], error: null });
    updateWebhook.mockResolvedValue({
      data: { ...endpoint, events: ["license.updated"] },
      error: null,
    });
    render(<WebhooksSection {...props} />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("All events")).toBeChecked();
    await user.click(screen.getByLabelText("License updated"));
    expect(screen.getByLabelText("All events")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateWebhook).toHaveBeenCalledWith(4, {
      name: "CMDB",
      url: "https://example.com/hook",
      events: ["license.updated"],
    }));
  });
});

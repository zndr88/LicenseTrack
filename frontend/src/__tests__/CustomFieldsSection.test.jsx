import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CustomFieldsSection from "../components/settings/sections/CustomFieldsSection.jsx";
import { getCustomFieldSectionLabel } from "../utils/customFieldPresentation.js";
import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  reorderCustomFields,
  updateCustomFieldSection,
} from "../api/settings.js";

vi.mock("../api/settings.js", () => ({
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
  reorderCustomFields: vi.fn(),
  deleteCustomField: vi.fn(),
  updateCustomFieldSection: vi.fn(),
}));

const baseProps = {
  isOpen: true,
  isDirty: false,
  onToggle: vi.fn(),
  onError: vi.fn(),
  onToast: vi.fn(),
};

function renderSection(props = {}) {
  return render(<CustomFieldsSection {...baseProps} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  listCustomFields.mockResolvedValue({
    data: [
      {
        id: 1,
        name: "Contract Owner",
        fieldKey: "contract_owner",
        fieldType: "text",
        section: "",
        displayOrder: 0,
      },
    ],
    error: null,
  });
  createCustomField.mockResolvedValue({
    data: {
      id: 2,
      name: "Security Reviewer",
      fieldKey: "security_reviewer",
      fieldType: "boolean",
      section: "",
      displayOrder: 1,
    },
    error: null,
  });
  reorderCustomFields.mockResolvedValue({ data: [], error: null });
  updateCustomFieldSection.mockResolvedValue({ data: {}, error: null });
  deleteCustomField.mockResolvedValue({ data: { affectedLicenses: 3 }, error: null });
});

afterEach(() => {
  cleanup();
});

describe("CustomFieldsSection", () => {
  test("renders section labels from the shared custom field presentation source", async () => {
    renderSection();

    const sectionSelect = await screen.findByRole("combobox", { name: /section for contract owner/i });
    const labels = within(sectionSelect).getAllByRole("option").map((option) => option.textContent);

    expect(labels).toEqual([
      `-- ${getCustomFieldSectionLabel(null)} --`,
      getCustomFieldSectionLabel("identity"),
      getCustomFieldSectionLabel("dates"),
      getCustomFieldSectionLabel("commercial"),
      getCustomFieldSectionLabel("people"),
      getCustomFieldSectionLabel("documents"),
      getCustomFieldSectionLabel("notes"),
    ]);
    expect(getCustomFieldSectionLabel("unknown")).toBe("Custom Fields");
  });

  test("updates a custom field section with the same payload shape", async () => {
    const user = userEvent.setup();
    const onCustomFieldsChanged = vi.fn();
    renderSection({ onCustomFieldsChanged });

    const sectionSelect = await screen.findByRole("combobox", { name: /section for contract owner/i });
    await user.selectOptions(sectionSelect, "people");

    expect(updateCustomFieldSection).toHaveBeenCalledWith(1, "people");
    expect(onCustomFieldsChanged).toHaveBeenCalledTimes(1);
  });

  test("rolls back a custom field section when the API rejects the update", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    updateCustomFieldSection.mockResolvedValueOnce({ data: null, error: "Section update failed" });
    renderSection({ onError });

    const sectionSelect = await screen.findByRole("combobox", { name: /section for contract owner/i });
    await user.selectOptions(sectionSelect, "people");

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Section update failed"));
    expect(sectionSelect).toHaveValue("");
  });

  test("creates a custom field with the same API payload", async () => {
    const user = userEvent.setup();
    const onCustomFieldsChanged = vi.fn();
    renderSection({ onCustomFieldsChanged });

    await user.click(await screen.findByRole("button", { name: /add field/i }));
    await user.type(screen.getByLabelText(/field name/i), "Security Reviewer");
    await user.selectOptions(screen.getByLabelText(/type/i), "boolean");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(createCustomField).toHaveBeenCalledWith({
      name: "Security Reviewer",
      fieldType: "boolean",
      displayOrder: 1,
    });
    expect(onCustomFieldsChanged).toHaveBeenCalledTimes(1);
  });

  test("updates custom field display order atomically", async () => {
    const user = userEvent.setup();
    listCustomFields.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          name: "Contract Owner",
          fieldKey: "contract_owner",
          fieldType: "text",
          section: "",
          displayOrder: 0,
        },
        {
          id: 2,
          name: "Renewal Flag",
          fieldKey: "renewal_flag",
          fieldType: "boolean",
          section: "",
          displayOrder: 1,
        },
      ],
      error: null,
    });
    reorderCustomFields.mockResolvedValueOnce({
      data: [
        {
          id: 2,
          name: "Renewal Flag",
          fieldKey: "renewal_flag",
          fieldType: "boolean",
          section: "",
          displayOrder: 0,
        },
        {
          id: 1,
          name: "Contract Owner",
          fieldKey: "contract_owner",
          fieldType: "text",
          section: "",
          displayOrder: 1,
        },
      ],
      error: null,
    });
    const onCustomFieldsChanged = vi.fn();
    renderSection({ onCustomFieldsChanged });

    await user.click(await screen.findByRole("button", { name: /move contract owner down/i }));

    await waitFor(() => {
      expect(reorderCustomFields).toHaveBeenCalledWith([2, 1]);
      expect(onCustomFieldsChanged).toHaveBeenCalledTimes(1);
    });
  });

  test("rolls back custom field display order when a reorder update fails", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const originalFields = {
      data: [
        {
          id: 1,
          name: "Contract Owner",
          fieldKey: "contract_owner",
          fieldType: "text",
          section: "",
          displayOrder: 0,
        },
        {
          id: 2,
          name: "Renewal Flag",
          fieldKey: "renewal_flag",
          fieldType: "boolean",
          section: "",
          displayOrder: 1,
        },
      ],
      error: null,
    };
    listCustomFields
      .mockResolvedValueOnce(originalFields)
      .mockResolvedValueOnce(originalFields);
    reorderCustomFields.mockResolvedValueOnce({ data: null, error: "Order update failed" });
    renderSection({ onError });

    await user.click(await screen.findByRole("button", { name: /move contract owner down/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Order update failed"));
    const fieldRows = screen.getAllByRole("row").slice(1);
    expect(within(fieldRows[0]).getByText("Contract Owner")).toBeInTheDocument();
    expect(within(fieldRows[1]).getByText("Renewal Flag")).toBeInTheDocument();
  });

  test("deletes a custom field by id with the same API call", async () => {
    const user = userEvent.setup();
    const onCustomFieldsChanged = vi.fn();
    renderSection({ onCustomFieldsChanged });

    await user.click(await screen.findByRole("button", { name: /delete contract owner/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(deleteCustomField).toHaveBeenCalledWith(1);
    expect(onCustomFieldsChanged).toHaveBeenCalledTimes(1);
  });
});

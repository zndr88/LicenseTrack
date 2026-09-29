import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FieldEditModal from "../components/licenses/FieldEditModal.jsx";
import { patchLicenseField } from "../api/licenses.js";

vi.mock("../api/licenses.js", () => ({ patchLicenseField: vi.fn() }));
vi.mock("../components/ui/Icon.jsx", () => ({ default: () => null }));

function renderUnitPrice(numberFormatLocale, currentValue = "") {
  const onSave = vi.fn();
  render(
    <FieldEditModal
      licenseId={1}
      fieldKey="unitPrice"
      fieldLabel="Unit Price"
      currentValue={currentValue}
      inputType="text"
      onSave={onSave}
      onClose={vi.fn()}
      userSettings={{ numberFormatLocale }}
    />,
  );
  return { onSave, input: document.getElementById("field-edit-value") };
}

describe("FieldEditModal number fields (issue #82)", () => {
  beforeEach(() => patchLicenseField.mockReset());

  it("saves 2,443.00 typed under en-US as 2443.00, and keeps the text on blur", async () => {
    patchLicenseField.mockResolvedValueOnce({ data: { id: 1, unitPrice: "2443.00" }, error: null });
    const { input, onSave } = renderUnitPrice("en-US");
    fireEvent.change(input, { target: { value: "2,443.00" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("2,443.00");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchLicenseField).toHaveBeenCalledWith(1, "unitPrice", "2443.00"));
    expect(onSave).toHaveBeenCalled();
  });

  it("refuses 2,443.00 under de-DE with a message, without changing or clearing it", async () => {
    const { input } = renderUnitPrice("de-DE", "10");
    fireEvent.change(input, { target: { value: "2,443.00" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("2,443.00");
    expect(screen.getByRole("alert")).toHaveTextContent("Not a valid number in your number format");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Fix the number above before saving.")).toBeInTheDocument();
    expect(patchLicenseField).not.toHaveBeenCalled();
  });

  it("shows a stored price in the user's number format", () => {
    const { input } = renderUnitPrice("de-DE", "2443");
    expect(input).toHaveValue("2.443,00");
  });
});

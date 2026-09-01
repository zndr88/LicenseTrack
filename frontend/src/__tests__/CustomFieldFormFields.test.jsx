import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CustomFieldFormFields from "../components/licenses/CustomFieldFormFields.jsx";

const definitions = [
  { id: 1, name: "Asset owner", fieldType: "text", section: "identity" },
  { id: 2, name: "Invoice date", fieldType: "date", section: "dates" },
  { id: 3, name: "Additional note", fieldType: "text", section: null },
];

afterEach(cleanup);

describe("CustomFieldFormFields", () => {
  it("renders ordinary form fields without manufacturing section containers", () => {
    render(
      <CustomFieldFormFields
        definitions={definitions}
        values={{}}
        onChange={vi.fn()}
        idPrefix="test"
      />
    );

    expect(screen.getByLabelText("Asset owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice date")).toBeInTheDocument();
    expect(screen.getByLabelText("Additional note")).toBeInTheDocument();
    expect(document.querySelector("fieldset")).not.toBeInTheDocument();
    expect(document.querySelector("legend")).not.toBeInTheDocument();
  });

  it("uses the persisted section key only to select the placement slot", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomFieldFormFields
        definitions={definitions}
        values={{ 2: "2026-09-01" }}
        onChange={onChange}
        idPrefix="test"
        section="dates"
      />
    );

    expect(screen.getByLabelText("Invoice date")).toHaveValue("2026-09-01");
    expect(screen.queryByLabelText("Asset owner")).not.toBeInTheDocument();
    expect(screen.queryByText("Key Dates & Contract")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Invoice date"), { target: { value: "2026-09-02" } });
    expect(onChange).toHaveBeenCalledWith({ 2: "2026-09-02" });

    rerender(
      <CustomFieldFormFields
        definitions={definitions}
        values={{}}
        onChange={onChange}
        idPrefix="test"
        section="__catchall__"
      />
    );
    expect(screen.getByLabelText("Additional note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoice date")).not.toBeInTheDocument();
  });
});

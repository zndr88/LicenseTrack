import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ProcurementInlineEditField } from "../components/procurement/ProcurementInlineEditCell.jsx";

describe("ProcurementInlineEditField", () => {
  test("Escape restores the current value without saving", () => {
    const onSave = vi.fn();
    render(
      <ProcurementInlineEditField
        item={{ id: 1 }}
        fieldKey="softwareDescription"
        label="Description"
        currentValue="Original"
        onSave={onSave}
      />,
    );
    const input = screen.getByRole("textbox", { name: /edit description/i });

    fireEvent.change(input, { target: { value: "Edited" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("Original");
    expect(onSave).not.toHaveBeenCalled();
  });
});

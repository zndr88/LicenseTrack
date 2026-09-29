import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("ProcurementInlineEditField quantity under nl-BE (#63)", () => {
  function renderQuantity(onSave, currentValue = "1000") {
    render(
      <ProcurementInlineEditField
        item={{ id: 5 }}
        fieldKey="quantity"
        label="Quantity"
        currentValue={currentValue}
        valueType="quantity"
        userSettings={{ numberFormatLocale: "nl-BE" }}
        onSave={onSave}
      />,
    );
    return screen.getByRole("textbox", { name: /edit quantity/i });
  }

  test("shows a whole thousand as text that reads back unchanged", () => {
    expect(renderQuantity(vi.fn())).toHaveValue("1000");
  });

  test("leaving an untouched quantity saves nothing", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const input = renderQuantity(onSave);
    fireEvent.blur(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSave).not.toHaveBeenCalled();
  });

  test("edited quantities are saved canonically", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const input = renderQuantity(onSave);
    fireEvent.change(input, { target: { value: "1250" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(5, "quantity", "1250"));
  });

  test("comma-decimal edits are saved canonically", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const input = renderQuantity(onSave, "2.5");
    expect(input).toHaveValue("2,5");
    fireEvent.change(input, { target: { value: "3,75" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(5, "quantity", "3.75"));
  });
});

describe("ProcurementInlineEditField money under de-DE", () => {
  function renderPrice(onSave) {
    render(
      <ProcurementInlineEditField
        item={{ id: 7 }}
        fieldKey="estimatedUnitPrice"
        label="Unit price"
        currentValue="100.00"
        valueType="money"
        userSettings={{ numberFormatLocale: "de-DE" }}
        onSave={onSave}
      />,
    );
    return screen.getByRole("textbox", { name: /edit unit price/i });
  }

  test.each([
    ["2,443.00", /not a valid number/i],
    ["2.443", /ambiguous/i],
  ])("refuses %j with a message instead of saving", async (typed, message) => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const input = renderPrice(onSave);
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByTitle(message)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("saves text in the user's format canonically", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const input = renderPrice(onSave);
    fireEvent.change(input, { target: { value: "2.443,50" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "estimatedUnitPrice", "2443.50"));
  });
});

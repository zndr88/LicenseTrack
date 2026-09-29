import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import NumberInput, { isValidNumberValue } from "../components/ui/NumberInput.jsx";

const enUS = { numberFormatLocale: "en-US" };
const deDE = { numberFormatLocale: "de-DE" };

function Harness({ initial = "", settings = enUS, onValue = () => {}, minFractionDigits = 0 }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberInput
        aria-label="Unit price"
        value={value}
        settings={settings}
        minFractionDigits={minFractionDigits}
        onChange={(next) => { setValue(next); onValue(next); }}
      />
      <button type="button" onClick={() => setValue("99.5")}>Set from outside</button>
    </>
  );
}

const input = () => screen.getByLabelText("Unit price");

describe("NumberInput", () => {
  it("shows a stored value in the user's number format", () => {
    render(<Harness initial="1234.5" settings={deDE} minFractionDigits={2} />);
    expect(input()).toHaveValue("1.234,50");
  });

  it("emits the canonical value for valid typing and keeps what was typed until blur", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(input(), { target: { value: "2,443.00" } });
    expect(onValue).toHaveBeenLastCalledWith("2443.00");
    expect(input()).toHaveValue("2,443.00");
    fireEvent.blur(input());
    expect(input()).toHaveValue("2,443.00");
  });

  it("never rewrites or clears invalid input, and explains it on blur (issue #82)", () => {
    const onValue = vi.fn();
    render(<Harness settings={deDE} onValue={onValue} />);
    fireEvent.change(input(), { target: { value: "2,443.00" } });
    expect(onValue).toHaveBeenLastCalledWith("2,443.00");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input());
    expect(input()).toHaveValue("2,443.00");
    expect(screen.getByRole("alert")).toHaveTextContent("Not a valid number in your number format (for example 1.234,56)");
    expect(input()).toHaveAttribute("aria-invalid", "true");
  });

  it("explains an ambiguous single dot group", () => {
    render(<Harness settings={deDE} />);
    fireEvent.change(input(), { target: { value: "1.234" } });
    fireEvent.blur(input());
    expect(screen.getByRole("alert")).toHaveTextContent("Type 1234 for a whole number, or 1,234 for a decimal.");
  });

  it("clears the message once the input is fixed", () => {
    render(<Harness settings={deDE} />);
    fireEvent.change(input(), { target: { value: "1.234" } });
    fireEvent.blur(input());
    fireEvent.change(input(), { target: { value: "1234" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("emits an empty string for blank input", () => {
    const onValue = vi.fn();
    render(<Harness initial="5" onValue={onValue} />);
    fireEvent.change(input(), { target: { value: "" } });
    expect(onValue).toHaveBeenLastCalledWith("");
  });

  it("takes a new value from outside, such as an auto-calculated total", () => {
    render(<Harness initial="1" settings={deDE} />);
    fireEvent.click(screen.getByRole("button", { name: "Set from outside" }));
    expect(input()).toHaveValue("99,5");
  });

  it("reformats a valid value on blur", () => {
    render(<Harness settings={deDE} minFractionDigits={2} />);
    fireEvent.change(input(), { target: { value: "1234,5" } });
    fireEvent.blur(input());
    expect(input()).toHaveValue("1.234,50");
  });
});

describe("isValidNumberValue", () => {
  it("accepts blank and canonical values only", () => {
    expect(isValidNumberValue("")).toBe(true);
    expect(isValidNumberValue(null)).toBe(true);
    expect(isValidNumberValue("1234.5")).toBe(true);
    expect(isValidNumberValue("2,443.00")).toBe(false);
  });
});

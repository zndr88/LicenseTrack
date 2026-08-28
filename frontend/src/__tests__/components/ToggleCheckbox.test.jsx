import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import Checkbox from "../../components/ui/Checkbox.jsx";
import Toggle from "../../components/ui/Toggle.jsx";

describe.each([
  ["checkbox"],
  ["switch"],
])("native %s activation", (role) => {
  test.each(["{Enter}", " "])("toggles exactly once for %s", async (key) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const control = role === "checkbox"
      ? <Checkbox checked={false} onChange={onChange} label="Selected" />
      : <Toggle value={false} onChange={onChange} ariaLabel="Enabled" />;

    render(control);
    screen.getByRole(role).focus();
    await user.keyboard(key);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("toggles exactly once for click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const control = role === "checkbox"
      ? <Checkbox checked={false} onChange={onChange} label="Selected" />
      : <Toggle value={false} onChange={onChange} ariaLabel="Enabled" />;

    render(control);
    await user.click(screen.getByRole(role));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

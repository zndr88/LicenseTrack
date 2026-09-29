import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import Tooltip from "../../../components/ui/Tooltip.jsx";

function renderTip() {
  render(<Tooltip content="Helpful text"><button type="button">Trigger</button></Tooltip>);
  return screen.getByRole("button", { name: "Trigger" });
}

describe("Tooltip", () => {
  test("is hidden until hover", () => {
    const trigger = renderTip();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful text");
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("opens on keyboard focus and describes the trigger", () => {
    const trigger = renderTip();
    fireEvent.focus(trigger);
    const tip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("Escape closes it", () => {
    const trigger = renderTip();
    fireEvent.focus(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("keeps the child's own handlers", () => {
    let hovered = false;
    render(
      <Tooltip content="x"><button type="button" onMouseEnter={() => { hovered = true; }}>T</button></Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(hovered).toBe(true);
  });

  test("renders the child alone when there is no content", () => {
    render(<Tooltip content={null}><button type="button">Plain</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

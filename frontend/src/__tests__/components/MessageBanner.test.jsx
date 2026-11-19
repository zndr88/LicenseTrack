import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageBanner from "../../components/ui/MessageBanner.jsx";

describe("MessageBanner", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<MessageBanner message={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["success", "status"],
    ["info", "status"],
    ["warning", "status"],
    ["error", "alert"],
  ])("styles and announces a %s message", (type, role) => {
    render(<MessageBanner message={{ msg: "Something happened", type }} onDismiss={() => {}} />);

    const banner = screen.getByRole(role);
    expect(banner).toHaveTextContent("Something happened");
    expect(banner).toHaveClass("msg", `msg-${type}`);
  });

  it("does not style a warning as a success", () => {
    render(
      <MessageBanner
        message={{ msg: "Request saved, but some documents could not be uploaded", type: "warning" }}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole("status")).not.toHaveClass("msg-success");
  });

  it("uses the floating layout when asked", () => {
    render(<MessageBanner floating message={{ msg: "Saved", type: "success" }} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toHaveClass("msg-floating");
  });

  it("runs the action and then dismisses", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MessageBanner
        message={{ msg: "Converted", type: "success", action: { label: "View", onClick } }}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<MessageBanner message={{ msg: "Failed", type: "error" }} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

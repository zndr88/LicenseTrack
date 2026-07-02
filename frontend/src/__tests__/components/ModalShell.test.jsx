import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ModalShell from "../../components/ui/ModalShell.jsx";

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

describe("ModalShell", () => {
  test("default header renders title and close button", () => {
    render(
      <ModalShell title="Default Modal" titleId="default-modal-title" onClose={vi.fn()}>
        <div>Body</div>
      </ModalShell>
    );

    expect(screen.getByRole("heading", { name: "Default Modal" })).toHaveAttribute("id", "default-modal-title");
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Default Modal" })).toBeInTheDocument();
  });

  test("default close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="Closable Modal" titleId="closable-modal-title" onClose={onClose}>
        <div>Body</div>
      </ModalShell>
    );

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("custom header renders instead of default header", () => {
    render(
      <ModalShell
        title="Default Should Not Render"
        titleId="custom-modal-title"
        header={<div className="modal-hd"><h2 id="custom-modal-title">Custom Header</h2></div>}
        onClose={vi.fn()}
      >
        <div>Body</div>
      </ModalShell>
    );

    expect(screen.getByRole("heading", { name: "Custom Header" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Default Should Not Render" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
  });

  test("custom header with titleId labels the dialog", () => {
    render(
      <ModalShell
        titleId="custom-labelled-title"
        header={<div className="modal-hd"><h2 id="custom-labelled-title">Custom Label</h2></div>}
        onClose={vi.fn()}
      >
        <div>Body</div>
      </ModalShell>
    );

    expect(screen.getByRole("dialog", { name: "Custom Label" })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import FieldLabel from "../../../components/ui/FieldLabel.jsx";

describe("FieldLabel", () => {
  test("labels its field and explains it on focus", () => {
    render(
      <>
        <FieldLabel htmlFor="f" info="Background text">Public app URL</FieldLabel>
        <input id="f" />
      </>,
    );
    expect(screen.getByLabelText("Public app URL")).toHaveAttribute("id", "f");
    fireEvent.focus(screen.getByRole("button", { name: "About Public app URL" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Background text");
  });

  test("is a plain label without info", () => {
    render(<FieldLabel htmlFor="f">Name</FieldLabel>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("as=span renders a caption instead of a label", () => {
    render(<FieldLabel as="span" className="dp-field-label" info="More">Supplier Contact</FieldLabel>);
    expect(screen.getByText("Supplier Contact").tagName).toBe("SPAN");
    expect(screen.getByRole("button", { name: "About Supplier Contact" })).toBeInTheDocument();
  });

  test("infoLabel overrides the accessible name of the ⓘ", () => {
    render(<FieldLabel htmlFor="f" info="More" infoLabel="What this means">Thing</FieldLabel>);
    expect(screen.getByRole("button", { name: "What this means" })).toBeInTheDocument();
  });
});

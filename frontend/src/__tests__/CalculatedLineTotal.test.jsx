import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CalculatedLineTotal from "../components/licenses/CalculatedLineTotal.jsx";

describe("CalculatedLineTotal", () => {
  it("shows quantity x unit price", () => {
    render(<CalculatedLineTotal id="t" quantity="400" unitPrice="18" currency="EUR" locale="en-US" />);
    expect(screen.getByText("Line Total")).toBeInTheDocument();
    expect(screen.getByText(/7,200\.00/)).toBeInTheDocument();
  });

  it("shows a dash when quantity or price is missing", () => {
    render(<CalculatedLineTotal id="t" quantity="" unitPrice="18" currency="EUR" locale="en-US" />);
    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });
});

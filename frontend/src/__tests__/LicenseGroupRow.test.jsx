import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LicenseGroupRow from "../components/pages/licenses/LicenseGroupRow.jsx";

const node = (overrides = {}) => ({
  id: "poNumber:po-1",
  columnKey: "poNumber",
  columnLabel: "PO #",
  key: "po-1",
  label: "PO-1",
  depth: 0,
  lines: [],
  children: [],
  summary: {
    shownCount: 3,
    totalCount: 5,
    lineSumByCurrency: { EUR: 12520 },
    earliestEndDate: "2027-10-31",
    poTotalByCurrency: { EUR: 12000 },
    poOverrideMismatch: true,
  },
  ...overrides,
});

function renderRow(props = {}) {
  const onToggle = vi.fn();
  render(
    <table><tbody>
      <LicenseGroupRow node={node()} colSpan={8} expanded={false} onToggle={onToggle} locale="en-US" userSettings={{}} {...props} />
    </tbody></table>,
  );
  return { onToggle };
}

describe("LicenseGroupRow", () => {
  it("shows the label, counts, totals, earliest end and PO value", () => {
    renderRow();
    expect(screen.getByRole("button", { name: /PO # · PO-1/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3 of 5 lines")).toBeInTheDocument();
    expect(screen.getByText(/12,520\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Total PO Value/)).toBeInTheDocument();
    expect(screen.getByText(/12,000\.00/)).toBeInTheDocument();
    expect(screen.getByTitle(/manual PO total differs/i)).toBeInTheDocument();
  });

  it("shows '5 lines' when nothing is filtered out", () => {
    renderRow({ node: node({ summary: { ...node().summary, shownCount: 5 } }) });
    expect(screen.getByText("5 lines")).toBeInTheDocument();
  });

  it("toggles on click of the button and of the row", () => {
    const { onToggle } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: /PO # · PO-1/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("poNumber:po-1");
    fireEvent.click(screen.getByText("3 of 5 lines"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});

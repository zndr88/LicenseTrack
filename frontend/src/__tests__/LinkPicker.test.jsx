import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LinkPicker from "../components/ui/LinkPicker.jsx";

const candidates = [
  { id: 1, title: "Acme Year 1", subtitle: "Acme · Widgets", meta: "Active" },
  { id: 2, title: "Acme Year 2", subtitle: "Acme · Widgets", meta: "Upcoming" },
  { id: 3, title: "Globex", subtitle: "Globex · Gadgets", meta: "Active", disabled: true, disabledReason: "Already linked" },
];

describe("LinkPicker", () => {
  it("single-select returns exactly one id and replaces the prior choice", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LinkPicker candidates={candidates} selectedIds={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("option", { name: /Acme Year 1/ }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
    rerender(<LinkPicker candidates={candidates} selectedIds={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("option", { name: /Acme Year 2/ }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  it("multi-select toggles ids in candidate order", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LinkPicker candidates={candidates} multiple selectedIds={[2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("option", { name: /Acme Year 1/ }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);
    rerender(<LinkPicker candidates={candidates} multiple selectedIds={[1, 2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("option", { name: /Acme Year 2/ }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it("does not select a disabled candidate and surfaces its reason", () => {
    const onChange = vi.fn();
    render(<LinkPicker candidates={candidates} selectedIds={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("option", { name: /Globex/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Already linked")).toBeInTheDocument();
  });

  it("filters by the search box across title, subtitle and meta", () => {
    render(<LinkPicker candidates={candidates} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "globex" } });
    expect(screen.queryByRole("option", { name: /Acme Year 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Globex/ })).toBeInTheDocument();
  });

  it("renders a relationship badge only for a selected candidate", () => {
    const relationship = (candidate) => (candidate.id === 1 ? { tone: "warning", text: "3-day gap between terms" } : null);
    const { rerender } = render(
      <LinkPicker candidates={candidates} selectedIds={[]} onChange={vi.fn()} relationship={relationship} />,
    );
    expect(screen.queryByText("3-day gap between terms")).not.toBeInTheDocument();
    rerender(<LinkPicker candidates={candidates} selectedIds={[1]} onChange={vi.fn()} relationship={relationship} />);
    expect(screen.getByText("3-day gap between terms")).toBeInTheDocument();
  });
});

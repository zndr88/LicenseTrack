import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TermSuccessorModal from "../components/procurement/TermSuccessorModal.jsx";

const base = (overrides) => ({ sourcingRequestId: 8, ...overrides });

describe("TermSuccessorModal", () => {
  it("links this line into a chosen existing later term", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    const items = [
      base({ id: 1, softwareDescription: "Year 1", startDate: "2026-01-01", endDate: "2026-12-31" }),
      base({ id: 2, softwareDescription: "Year 2", startDate: "2027-01-01", endDate: "2027-12-31" }),
      base({ id: 3, softwareDescription: "Year 3" }),
    ];
    render(<TermSuccessorModal target={items[0]} items={items} onSave={onSave} onCreateNew={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("option", { name: /Year 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Set next term" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(2, [1]));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps a successor's existing predecessors when consolidating", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const items = [
      base({ id: 1, softwareDescription: "Line A" }),
      base({ id: 3, softwareDescription: "Combined" }),
      base({ id: 4, softwareDescription: "Line B", successorSourcingItemId: 3 }),
    ];
    render(<TermSuccessorModal target={items[0]} items={items} onSave={onSave} onCreateNew={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("option", { name: /Combined/ }));
    fireEvent.click(screen.getByRole("button", { name: "Set next term" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(3, [4, 1]));
  });

  it("does not offer ancestors of the current line as its next term", () => {
    const items = [
      base({ id: 1, softwareDescription: "This line" }),
      base({ id: 2, softwareDescription: "Earlier term", successorSourcingItemId: 1 }),
      base({ id: 3, softwareDescription: "Sibling" }),
    ];
    render(<TermSuccessorModal target={items[0]} items={items} onSave={vi.fn()} onCreateNew={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("option", { name: /Earlier term/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sibling/ })).toBeInTheDocument();
  });

  it("falls back to creating a brand-new term line", () => {
    const onCreateNew = vi.fn();
    const items = [base({ id: 1, softwareDescription: "Year 1" })];
    render(<TermSuccessorModal target={items[0]} items={items} onSave={vi.fn()} onCreateNew={onCreateNew} onCancel={vi.fn()} />);
    expect(screen.getByText("No other lines in this request can be its next term.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create a new term line instead/ }));
    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});

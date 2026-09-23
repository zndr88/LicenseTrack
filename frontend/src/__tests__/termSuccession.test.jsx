import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TermPredecessorsModal from "../components/procurement/TermPredecessorsModal.jsx";
import TermChain from "../components/licenses/detail/TermChain.jsx";
import { nextTermDraft } from "../utils/nextTermDraft.js";

describe("term succession", () => {
  it("prefills a next term while leaving commercial fields editable", () => {
    expect(nextTermDraft({
      id: 12, endDate: "2028-02-29", quantity: "10", invoiceNumber: "INV-1",
    })).toEqual(expect.objectContaining({
      id: undefined, startDate: "2028-03-01", endDate: "2029-02-28",
      quantity: "10", invoiceNumber: "", renewalForLicenseId: null,
    }));
  });

  it("lets a manager select several predecessors for one future line", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    const items = [
      { id: 1, sourcingRequestId: 8, softwareDescription: "A" },
      { id: 2, sourcingRequestId: 8, softwareDescription: "B" },
      { id: 3, sourcingRequestId: 8, softwareDescription: "Combined" },
    ];
    render(<TermPredecessorsModal target={items[2]} items={items} onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("option", { name: "A" }));
    fireEvent.click(screen.getByRole("option", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: "Save term links" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(3, [1, 2]));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a whole linked chain including upcoming terms", () => {
    const allLicenses = [
      { id: 1, softwareDescription: "A", startDate: "2026-01-01", endDate: "2026-12-31", renewedToId: 2, expirationStatus: "active", quantity: "10" },
      { id: 2, softwareDescription: "B", startDate: "2027-01-01", endDate: "2027-12-31", renewedFromId: 1, renewedToId: 3, expirationStatus: "upcoming", quantity: "12" },
      { id: 3, softwareDescription: "C", startDate: "2028-01-01", endDate: "2028-12-31", renewedFromId: 2, expirationStatus: "upcoming", quantity: "12" },
    ];
    render(<TermChain license={allLicenses[0]} allLicenses={allLicenses} userSettings={{}} onNavigate={vi.fn()} isOpen onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /term chain \(3 terms\)/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "License term chain" })).toHaveTextContent("A");
    expect(screen.getByRole("region", { name: "License term chain" })).toHaveTextContent("B");
    expect(screen.getByRole("region", { name: "License term chain" })).toHaveTextContent("C");
  });

  it("starts collapsed and is absent for a single term", () => {
    const chain = [
      { id: 1, softwareDescription: "A", renewedToId: 2 },
      { id: 2, softwareDescription: "B", renewedFromId: 1 },
    ];
    const { unmount } = render(<TermChain license={chain[0]} allLicenses={chain} userSettings={{}} onNavigate={vi.fn()} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /term chain \(2 terms\)/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "License term chain" })).not.toBeInTheDocument();
    unmount();

    const { container } = render(<TermChain license={{ id: 9 }} allLicenses={[{ id: 9 }]} userSettings={{}} onNavigate={vi.fn()} isOpen onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

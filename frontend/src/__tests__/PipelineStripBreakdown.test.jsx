import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import PipelineStrip from "../components/pages/licenses/PipelineStrip.jsx";

const stats = { sourcing: 0, pending: 0, active: 30, upcoming: 1, expiring: 12, expired: 3, renewed: 2 };
const breakdowns = {
  expiring: { renewalInProgress: 5, retiring: 1, notStarted: 6 },
  expired: { renewalInProgress: 0, retiring: 0, notStarted: 3 },
};

function renderStrip() {
  render(<PipelineStrip stats={stats} breakdowns={breakdowns} onStageClick={vi.fn()} activeFilters={[]} />);
}

describe("PipelineStrip breakdown", () => {
  test("Expiring shows its breakdown on hover", () => {
    renderStrip();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /expiring/i }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("12 expiring · 5 renewal in progress · 1 retiring · 6 not started");
  });

  test("Expired shows its breakdown on keyboard focus, leaving zero parts out", () => {
    renderStrip();
    fireEvent.focus(screen.getByRole("button", { name: /expired/i }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("3 expired · 3 not started");
  });

  test("other stages have no tooltip", () => {
    renderStrip();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /active/i }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

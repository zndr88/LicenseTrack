import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PipelineStrip from "../components/pages/licenses/PipelineStrip.jsx";

describe("PipelineStrip", () => {
  it("shows unavailable auxiliary counts as unknown instead of zero", () => {
    render(
      <PipelineStrip
        stats={{ sourcing: null, pending: 0, active: 4 }}
        activeFilters={[]}
        onStageClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /sourcing/i })).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /pending/i })).toHaveTextContent("0");
  });
});

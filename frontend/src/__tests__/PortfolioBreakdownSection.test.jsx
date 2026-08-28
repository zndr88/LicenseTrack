import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import PortfolioBreakdownSection from "../components/reports/PortfolioBreakdownSection.jsx";

function renderSection(portfolioData, totalCount = 3) {
  return render(
    <PortfolioBreakdownSection
      portfolioData={portfolioData}
      totalCount={totalCount}
      isOpen
      onToggle={vi.fn()}
      forceOpen={false}
    />,
  );
}

describe("PortfolioBreakdownSection", () => {
  test("renders both populated donut panels and their legend totals", () => {
    renderSection({
      byType: [{ name: "Subscription", value: 2 }, { name: "Perpetual", value: 1 }],
      byMetric: [{ name: "Per user", value: 3 }],
    });

    expect(screen.getByText("By License Type")).toBeInTheDocument();
    expect(screen.getByText("By Billing Metric")).toBeInTheDocument();
    expect(screen.getByText("Subscription")).toBeInTheDocument();
    expect(screen.getByText("Perpetual")).toBeInTheDocument();
    expect(screen.getByText("Per user")).toBeInTheDocument();
  });

  test("keeps per-panel and whole-section empty states", () => {
    const { rerender } = renderSection({ byType: [], byMetric: [{ name: "Per user", value: 3 }] });
    expect(screen.getAllByText("No data available for the current filters")).toHaveLength(1);

    rerender(
      <PortfolioBreakdownSection
        portfolioData={{ byType: [], byMetric: [] }}
        totalCount={0}
        isOpen
        onToggle={vi.fn()}
        forceOpen={false}
      />,
    );
    expect(screen.getAllByText("No data available for the current filters")).toHaveLength(1);
  });
});

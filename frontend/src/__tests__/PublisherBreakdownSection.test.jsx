import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("recharts", () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    Bar: Stub, BarChart: Stub, CartesianGrid: Stub, Cell: Stub,
    ResponsiveContainer: Stub, Tooltip: Stub, XAxis: Stub, YAxis: Stub,
  };
});

import PublisherBreakdownSection from "../components/reports/PublisherBreakdownSection.jsx";

describe("PublisherBreakdownSection", () => {
  test("summary counts distinct suppliers, not publisher-supplier pairs", () => {
    const row = (publisher, supplier) => ({
      publisher, supplier, licenseCount: 1, totalSpend: 0, totalSpendByCurrency: {}, hasUnpricedLicenses: false,
    });
    render(
      <PublisherBreakdownSection
        publisherData={[{ publisher: "Adobe", totalSpend: 0 }, { publisher: "Microsoft", totalSpend: 0 }, { publisher: "Oracle", totalSpend: 0 }]}
        vendorData={[
          row("Adobe", "SoftwareOne"),
          row("Microsoft", "SoftwareOne"),
          row("Oracle", "Insight"),
          row("Oracle", ""),
        ]}
        locale="en-US"
        singleCurrency="EUR"
        isOpen
        onToggle={() => {}}
      />,
    );

    expect(screen.getByText("3 publishers · 2 suppliers")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });
});

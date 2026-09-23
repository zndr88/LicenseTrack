import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RenewalWorkbenchTable from "../components/pages/renewals/RenewalWorkbenchTable.jsx";

const supportRow = {
  licenseId: 3,
  rowKind: "support_renewal",
  publisherName: "Acme",
  softwareDescription: "Server (included support)",
  renewalStatus: "due_soon",
  daysUntilExpiry: 20,
  endDate: "2026-10-13",
  riskFlags: [],
  customFields: [],
  estimatedAnnualValue: 0,
  currency: "EUR",
};

describe("Renewal Workbench support rows", () => {
  it("offers Start support renewal and Record support", () => {
    const onStartSupportRenewal = vi.fn();
    const onRecordSupport = vi.fn();
    render(
      <RenewalWorkbenchTable
        visibleColumns={[{ id: "license", label: "License" }, { id: "actions", label: "Actions" }]}
        visibleRows={[supportRow]}
        locale="en-US"
        userSettings={{}}
        canStartRenewal
        canOpenPipeline
        renewalActionDays={30}
        onStartRenewal={vi.fn()}
        onStartSupportRenewal={onStartSupportRenewal}
        onRecordSupport={onRecordSupport}
      />,
    );

    expect(screen.queryByRole("button", { name: /initiate renewal/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start support renewal/i }));
    fireEvent.click(screen.getByRole("button", { name: /record existing support/i }));

    expect(onStartSupportRenewal).toHaveBeenCalledWith(supportRow);
    expect(onRecordSupport).toHaveBeenCalledWith(supportRow);
  });
});

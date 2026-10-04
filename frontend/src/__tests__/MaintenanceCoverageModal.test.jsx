import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MaintenanceCoverageModal from "../components/licenses/MaintenanceCoverageModal.jsx";

const perpetual = { id: 1, licenseRef: "LT-1", licenseType: "perpetual", publisherName: "Acme", softwareDescription: "Suite", maintenanceCoverage: "unknown" };
const maintenance = { id: 60, licenseRef: "LT-60", licenseType: "maintenance", publisherName: "Acme", softwareDescription: "Suite support", maintenanceParentIds: [] };

function renderModal(license = perpetual, onSave = vi.fn().mockResolvedValue({ error: null }), records = [maintenance]) {
  render(
    <MaintenanceCoverageModal
      license={license}
      allLicenses={[license, ...records]}
      userSettings={{ dateFormat: "DD/MM/YYYY" }}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return { onSave, dialog: screen.getByRole("dialog", { name: /maintenance coverage/i }) };
}

describe("MaintenanceCoverageModal", () => {
  it("reveals hidden maintenance on request and saves the selected record", async () => {
    const retired = { ...maintenance, id: 61, licenseRef: "LT-61", isRetired: true };
    const scheduled = { ...maintenance, id: 62, licenseRef: "LT-62", retirementScheduled: true };
    const linked = { ...retired, id: 63, licenseRef: "LT-63", maintenanceParentIds: [1] };
    const { dialog, onSave } = renderModal(perpetual, vi.fn().mockResolvedValue({ error: null }), [maintenance, retired, scheduled, linked]);
    fireEvent.change(within(dialog).getByLabelText("Maintenance Coverage"), { target: { value: "separately_tracked" } });
    expect(within(dialog).getByText(/2 hidden records/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /LT-61/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Show", exact: true }));
    expect(within(dialog).getByRole("option", { name: /LT-62/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /LT-63/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: /LT-61/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ coverage: "separately_tracked", quickLinkId: "61" }));
  });

  it("doesn't offer Separately tracked for a subscription", () => {
    const { dialog } = renderModal({ ...perpetual, licenseType: "subscription", maintenanceCoverage: "included" });
    const values = within(dialog).getAllByRole("option").map((option) => option.value);
    expect(values).not.toContain("separately_tracked");
  });

  it("shows the quick link only for Separately tracked, and saves both", async () => {
    const { onSave, dialog } = renderModal();
    expect(within(dialog).queryByText(/Link an existing maintenance record/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Maintenance Coverage"), { target: { value: "separately_tracked" } });
    fireEvent.click(within(dialog).getByRole("option", { name: /LT-60/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ coverage: "separately_tracked", quickLinkId: "60" }));
  });

  it("drops a chosen record when coverage moves away from Separately tracked", async () => {
    const { onSave, dialog } = renderModal();
    const select = within(dialog).getByLabelText("Maintenance Coverage");
    fireEvent.change(select, { target: { value: "separately_tracked" } });
    fireEvent.click(within(dialog).getByRole("option", { name: /LT-60/ }));
    fireEvent.change(select, { target: { value: "included" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ coverage: "included", quickLinkId: "" }));
  });

  it("shows a save error and stays open", async () => {
    const { dialog } = renderModal(perpetual, vi.fn().mockResolvedValue({ error: "Nope" }));
    fireEvent.change(within(dialog).getByLabelText("Maintenance Coverage"), { target: { value: "included" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Nope");
  });
});

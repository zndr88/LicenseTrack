import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MaintenanceCoverageModal from "../components/licenses/MaintenanceCoverageModal.jsx";

const perpetual = { id: 1, licenseRef: "LT-1", licenseType: "perpetual", publisherName: "Acme", softwareDescription: "Suite", maintenanceCoverage: "unknown" };
const maintenance = { id: 60, licenseRef: "LT-60", licenseType: "maintenance", publisherName: "Acme", softwareDescription: "Suite support", maintenanceParentIds: [] };

function renderModal(license = perpetual, onSave = vi.fn().mockResolvedValue({ error: null })) {
  render(
    <MaintenanceCoverageModal
      license={license}
      allLicenses={[license, maintenance]}
      userSettings={{ dateFormat: "DD/MM/YYYY" }}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return { onSave, dialog: screen.getByRole("dialog", { name: /maintenance coverage/i }) };
}

describe("MaintenanceCoverageModal", () => {
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

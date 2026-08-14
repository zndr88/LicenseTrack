import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MaintenanceSection from "../components/licenses/detail/MaintenanceSection.jsx";

vi.mock("../api/licenses.js", () => ({
  disableMaintenance: vi.fn(),
  getMaintenanceForParent: vi.fn(),
}));

vi.mock("../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

const baseProps = {
  license: {
    id: 1,
    licenseType: "perpetual",
    maintenanceCoverage: "unknown",
    hasMaintenance: false,
  },
  perms: { canEdit: true },
  userSettings: {},
  isOpen: true,
  onToggle: vi.fn(),
  maintenanceHistory: [],
  setMaintenanceHistory: vi.fn(),
  historyLoading: false,
  setShowMaintenanceModal: vi.fn(),
  onNavigate: vi.fn(),
  onUpdate: vi.fn(),
  setToast: vi.fn(),
  cfBySection: {},
  customFieldValues: [],
  vis: {},
  openFieldEdit: vi.fn(),
  makeCustomFieldSaveFn: vi.fn(),
  closeFieldEdit: vi.fn(),
  customFieldsLoading: false,
};

describe("MaintenanceSection", () => {
  it("hides linking controls until coverage is separately tracked", () => {
    render(<MaintenanceSection {...baseProps} />);

    expect(screen.queryByRole("button", { name: /add maintenance \/ support contract/i })).not.toBeInTheDocument();
    expect(screen.getByText(/classify maintenance or support coverage/i)).toBeInTheDocument();
  });

  it("shows linking controls for separately tracked coverage", () => {
    render(
      <MaintenanceSection
        {...baseProps}
        license={{ ...baseProps.license, maintenanceCoverage: "separately_tracked" }}
      />
    );

    expect(screen.getByRole("button", { name: /add maintenance \/ support contract/i })).toBeInTheDocument();
  });

  it("does not offer separate maintenance linking for subscriptions", () => {
    render(
      <MaintenanceSection
        {...baseProps}
        license={{
          ...baseProps.license,
          licenseType: "subscription",
          maintenanceCoverage: "separately_tracked",
        }}
      />
    );

    expect(screen.queryByRole("button", { name: /add maintenance \/ support contract/i })).not.toBeInTheDocument();
  });

  it("filters separately tracked coverage from subscription coverage edits", () => {
    const openFieldEdit = vi.fn();
    render(
      <MaintenanceSection
        {...baseProps}
        openFieldEdit={openFieldEdit}
        license={{ ...baseProps.license, licenseType: "subscription", maintenanceCoverage: "included" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit coverage/i }));

    expect(openFieldEdit).toHaveBeenCalledWith(expect.objectContaining({
      selectOptions: expect.not.arrayContaining([
        expect.objectContaining({ value: "separately_tracked" }),
      ]),
    }));
  });
});

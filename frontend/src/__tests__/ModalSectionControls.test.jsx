import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import LicenseFormSection from "../components/licenses/LicenseFormSection.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";

test("modal title controls collapse and expand sections after individual changes", () => {
  render(<ModalShell title="Add Sourcing Item" titleId="modal-section-test" sectionControls>
    <LicenseFormSection title="Identity"><input aria-label="Publisher" /></LicenseFormSection>
    <LicenseFormSection title="Details"><input aria-label="Quantity" /></LicenseFormSection>
  </ModalShell>);

  const dialog = screen.getByRole("dialog", { name: "Add Sourcing Item" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Details" }));
  expect(within(dialog).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(within(dialog).getByRole("button", { name: "Collapse all" }));
  expect(within(dialog).getByRole("button", { name: "Identity" })).toHaveAttribute("aria-expanded", "false");
  expect(within(dialog).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(within(dialog).getByRole("button", { name: "Expand all" }));
  expect(within(dialog).getByRole("button", { name: "Identity" })).toHaveAttribute("aria-expanded", "true");
  expect(within(dialog).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
});

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import PoDocumentWarning from "../../components/pages/licenses/PoDocumentWarning.jsx";

test("shows the saved PO change and dismisses the document verification reminder", () => {
  const onClose = vi.fn();
  render(<PoDocumentWarning warning={{ oldPoNumber: "PO-OLD", newPoNumber: "PO-NEW" }} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Verify attached documents" });
  expect(dialog).toHaveTextContent('from "PO-OLD" to "PO-NEW"');
  expect(dialog).toHaveTextContent("No documents were moved, deleted, or reassigned.");
  fireEvent.click(screen.getByRole("button", { name: "Understood" }));
  expect(onClose).toHaveBeenCalledOnce();
});

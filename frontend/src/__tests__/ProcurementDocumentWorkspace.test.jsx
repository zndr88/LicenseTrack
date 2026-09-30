import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProcurementDocumentWorkspace from "../components/procurement/ProcurementDocumentWorkspace.jsx";

const documents = [{ id: 17, originalFilename: "quote.pdf", mimeType: "application/pdf" }];

function renderWorkspace(props = {}) {
  const previewDocument = vi.fn().mockResolvedValue({ data: { url: "blob:stored-preview" }, error: null });
  render(
    <ProcurementDocumentWorkspace
      documents={documents}
      inputId="doc-input"
      label="Quote Document"
      onFileChange={vi.fn()}
      previewDocument={previewDocument}
      {...props}
    />,
  );
  return { previewDocument };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:local-preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProcurementDocumentWorkspace preview layout", () => {
  test("opening a preview collapses the document list behind a Show documents toggle", async () => {
    renderWorkspace();
    expect(screen.getByText("Attached to this workflow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show documents/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /quote\.pdf/ }));
    await waitFor(() => expect(screen.getByTitle("Preview of quote.pdf")).toBeInTheDocument());

    expect(screen.queryByText("Attached to this workflow")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show documents (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Upload Quote Document")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Attached to this workflow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide documents" })).toHaveAttribute("aria-expanded", "true");
  });

  test("closing the preview shows the list again and drops the toggle", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /quote\.pdf/ }));
    await waitFor(() => expect(screen.getByTitle("Preview of quote.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close document preview" }));

    expect(screen.getByText("Attached to this workflow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show documents/i })).toBeNull();
  });

  test("a chosen local file also collapses the list", () => {
    const file = new File(["%PDF-1.7"], "chosen.pdf", { type: "application/pdf" });
    renderWorkspace({ file });
    expect(screen.queryByText("Attached to this workflow")).toBeNull();
    expect(screen.getByRole("button", { name: "Show documents (1)" })).toHaveAttribute("aria-expanded", "false");
  });
});

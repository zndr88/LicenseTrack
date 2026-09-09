import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DocumentStagingWorkspace from "../components/procurement/DocumentStagingWorkspace.jsx";

const baseProps = {
  attachments: [],
  categoryScopes: {},
  documents: [],
  inputIdPrefix: "test-documents",
  onAddFiles: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onTargetChange: vi.fn(),
  onCategoryScopeChange: vi.fn(),
  previewDocument: vi.fn(),
  downloadDocument: vi.fn(),
  defaultOpen: true,
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:local-preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DocumentStagingWorkspace preview persistence", () => {
  test("keeps the selected staged-file preview and expanded state when Documents collapses", async () => {
    const file = new File(["%PDF-1.7"], "staged.pdf", { type: "application/pdf" });
    render(
      <DocumentStagingWorkspace
        {...baseProps}
        attachments={[{ id: "staged-1", file, category: "invoice", scope: "shared" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview staged.pdf" }));
    const preview = await screen.findByLabelText("Attached staged.pdf preview");
    fireEvent.click(screen.getByRole("button", { name: "Expand document preview" }));
    expect(preview).toHaveClass("is-expanded");

    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));

    expect(screen.queryByLabelText("Upload Invoice Document")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Attached staged.pdf preview")).toHaveClass("is-expanded");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test("keeps the selected stored-document preview and expanded state when Documents collapses", async () => {
    const previewDocument = vi.fn().mockResolvedValue({
      data: { url: "blob:stored-preview" },
      error: null,
    });
    render(
      <DocumentStagingWorkspace
        {...baseProps}
        documents={[{
          id: 17,
          category: "quote",
          originalFilename: "stored.pdf",
          mimeType: "application/pdf",
        }]}
        previewDocument={previewDocument}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview stored.pdf" }));
    await waitFor(() => expect(screen.getByTitle("Preview of stored.pdf")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand document preview" }));

    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));

    expect(screen.queryByLabelText("Upload Quote Document")).not.toBeInTheDocument();
    expect(screen.getByLabelText("stored.pdf preview")).toHaveClass("is-expanded");
    expect(previewDocument).toHaveBeenCalledWith(17, expect.objectContaining({ id: 17 }));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

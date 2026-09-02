import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import DocumentPreviewPanel from "../components/ui/DocumentPreviewPanel.jsx";

describe("DocumentPreviewPanel", () => {
  test("keeps generated blob PDF and image previews working", () => {
    const { rerender } = render(
      <DocumentPreviewPanel
        filename="invoice.pdf"
        kind="pdf"
        url="blob:https://licensetrack.example/pdf-preview"
      />,
    );

    expect(screen.getByTitle("Preview of invoice.pdf")).toHaveAttribute(
      "src",
      "blob:https://licensetrack.example/pdf-preview#zoom=page-width",
    );

    rerender(
      <DocumentPreviewPanel
        filename="scan.png"
        kind="image"
        url="blob:https://licensetrack.example/image-preview"
      />,
    );
    expect(screen.getByAltText("Preview of scan.png")).toHaveAttribute(
      "src",
      "blob:https://licensetrack.example/image-preview",
    );
  });

  test("rejects non-blob preview URLs without rendering active content", () => {
    render(
      <DocumentPreviewPanel
        filename="unsafe.pdf"
        kind="pdf"
        url="javascript:alert(document.domain)"
      />,
    );

    expect(screen.queryByTitle("Preview of unsafe.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("Preview is not available for this file type.")).toBeInTheDocument();
  });
});

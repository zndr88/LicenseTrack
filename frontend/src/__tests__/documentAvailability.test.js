import { describe, expect, test } from "vitest";
import {
  documentAvailabilityHelp,
  documentAvailabilitySummary,
  formatDocumentAvailabilitySummary,
  isFileAvailable,
} from "../utils/documentAvailability.js";
import { isPreviewablePdf, localDocumentPreviewKind } from "../utils/documentPreview.js";

describe("document availability helpers", () => {
  test("summarizes total records separately from currently available files", () => {
    const summary = documentAvailabilitySummary([
      { fileAvailability: "available" },
      { fileAvailability: "missing" },
      { file_availability: "unavailable" },
      {},
    ]);

    expect(summary).toEqual({
      total: 4,
      available: 2,
      missing: 1,
      unavailable: 1,
    });
    expect(formatDocumentAvailabilitySummary(summary)).toBe("4 documents · 2 available · 1 missing · 1 unavailable");
  });

  test("defaults old document responses to available and explains unavailable files", () => {
    expect(isFileAvailable({})).toBe(true);
    expect(isFileAvailable({ fileAvailability: "missing" })).toBe(false);
    expect(documentAvailabilityHelp({ fileAvailability: "missing" })).toBe(
      "The document record exists, but the file is missing from managed storage.",
    );
    expect(documentAvailabilityHelp({ fileAvailability: "unavailable" })).toBe(
      "The document record exists, but managed storage is unavailable.",
    );
  });

  test("detects previewable PDFs by MIME type or filename only when available", () => {
    expect(isPreviewablePdf({ mime_type: "application/pdf", original_filename: "file.bin" })).toBe(true);
    expect(isPreviewablePdf({ mimeType: "application/octet-stream", originalFilename: "invoice.PDF" })).toBe(true);
    expect(isPreviewablePdf({ mime_type: "text/plain", original_filename: "notes.txt" })).toBe(false);
    expect(isPreviewablePdf({ mime_type: "application/pdf", fileAvailability: "missing" })).toBe(false);
  });

  test("classifies safe local preview types and rejects MIME conflicts", () => {
    expect(localDocumentPreviewKind(new File([], "quote.pdf", { type: "application/pdf" }))).toBe("pdf");
    expect(localDocumentPreviewKind(new File([], "scan.jpg", { type: "image/jpeg" }))).toBe("image");
    expect(localDocumentPreviewKind(new File([], "notes.txt", { type: "text/plain" }))).toBe("text");
    expect(localDocumentPreviewKind(new File([], "quote.pdf", { type: "text/html" }))).toBeNull();
    expect(localDocumentPreviewKind(new File([], "quote.pdf"))).toBe("pdf");
  });
});

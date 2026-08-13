import { isFileAvailable } from "./documentAvailability.js";

function documentFilename(document) {
  return document?.original_filename ?? document?.originalFilename ?? document?.filename ?? "";
}

function documentMimeType(document) {
  return document?.mime_type ?? document?.mimeType ?? "";
}

export function isPreviewablePdf(document) {
  if (!isFileAvailable(document)) return false;

  const mimeType = String(documentMimeType(document)).trim().toLowerCase();
  if (mimeType === "application/pdf") return true;

  return String(documentFilename(document)).trim().toLowerCase().endsWith(".pdf");
}

export function getPreviewFilename(document) {
  return documentFilename(document) || "Document";
}

import { isFileAvailable } from "./documentAvailability.js";

function documentFilename(document) {
  return document?.original_filename ?? document?.originalFilename ?? document?.filename ?? "";
}

function documentMimeType(document) {
  return document?.mime_type ?? document?.mimeType ?? "";
}

export function localDocumentPreviewKind(file) {
  if (!file) return null;

  const mimeType = String(file.type || "").split(";", 1)[0].trim().toLowerCase();
  if (mimeType === "application/pdf") return "pdf";
  if (["image/png", "image/jpeg"].includes(mimeType)) return "image";
  if (mimeType === "text/plain") return "text";
  if (mimeType) return null;

  const filename = String(file.name || "").trim().toLowerCase();
  if (filename.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g)$/.test(filename)) return "image";
  if (filename.endsWith(".txt")) return "text";
  return null;
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

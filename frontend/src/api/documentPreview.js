import { get } from "./client.js";

export async function createPdfPreviewUrl(path) {
  const { data: response, error } = await get(path);
  if (error || !response) {
    return { data: null, error: error ?? "Preview failed" };
  }

  let blob;
  try {
    blob = await response.blob();
  } catch {
    return { data: null, error: "Preview failed" };
  }

  const previewBlob = blob.type === "application/pdf"
    ? blob
    : new Blob([blob], { type: "application/pdf" });

  return { data: { url: URL.createObjectURL(previewBlob) }, error: null };
}

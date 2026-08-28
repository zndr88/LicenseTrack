import { get } from "./client.js";

export async function downloadApiFile(path, { filename, fallbackError = "Download failed" } = {}) {
  const { data: response, error } = await get(path);
  if (error || !response) {
    return { data: null, error: error ?? fallbackError };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return { data: null, error: null };
}
